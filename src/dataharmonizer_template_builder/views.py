"""Django views for the DataHarmonizer template builder backend."""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any

from django.http import (
    FileResponse,
    HttpRequest,
    HttpResponse,
    HttpResponseNotAllowed,
    JsonResponse,
)
from django.views.static import serve as static_serve
from pydantic import BaseModel, ValidationError

from dataharmonizer_template_builder import dh_builder_runner, dh_compile, table_sync
from dataharmonizer_template_builder.conversion import ConversionService
from dataharmonizer_template_builder.models import SchemaSession, TableRows
from dataharmonizer_template_builder.sessions import store
from linkml_lib import diagnostics as linkml_diagnostics

converter = ConversionService()
_jobs: dict[str, dict[str, Any]] = {}
_HOST_DH_OUTPUT_DIR = os.environ.get("HOST_DH_OUTPUT_DIR", "dhtb-dh-output")
_HOST_DH_SCHEMA_DIR = os.environ.get("HOST_DH_SCHEMA_DIR", "dhtb-dh-schema")
_DH_SCHEMA_CONTAINER_DIR = Path(os.environ.get("DH_SCHEMA_CONTAINER_DIR", "/dh-schema"))
_DH_OUTPUT_DIR = Path("dh-output")
_DH_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIST = Path("frontend/dist")
FRONTEND_ASSETS = FRONTEND_DIST / "assets"
VITE_HASHED_ASSET_PREFIXES = ("index-", "jquery-", "_dh-preview-library-")
FRONTEND_CONFIG_ENV = "DHTB_FRONTEND_CONFIG_JSON"
DEFAULT_FRONTEND_CONFIG: dict[str, Any] = {
    "showImportButton": True,
    "showExportButton": True,
    "showGenerateButton": True,
    "showPreviewButton": True,
    "showDiagnostics": True,
    "allowExampleSchema": True,
    "hostName": "",
    "hostMode": "standalone",
}


class ImportRequest(BaseModel):
    """JSON request for schema import."""

    yaml: str
    name: str | None = None


class IntegrationSessionRequest(ImportRequest):
    """Host-facing request for opening a schema editing session."""

    source_id: str | None = None
    metadata: dict[str, Any] | None = None


class TablesRequest(BaseModel):
    """Request carrying editable tables."""

    tables: TableRows


class DhBuildRequest(BaseModel):
    """Request to rebuild a full DataHarmonizer preview bundle for a session."""

    session_id: str


def _bad_request(exc: ValidationError | json.JSONDecodeError) -> JsonResponse:
    return JsonResponse({"detail": str(exc)}, status=422)


def health(request: HttpRequest) -> JsonResponse:
    """Return backend health and optional tool status."""
    _, frontend_config_warning = _frontend_config()
    return JsonResponse(
        {
            "ok": True,
            "docker_available": dh_compile.docker_available(),
            "frontend_config_warning": frontend_config_warning,
        }
    )


def frontend_config(request: HttpRequest) -> JsonResponse:
    """Return backend-owned frontend feature flags for standalone or embedded use."""
    config, _ = _frontend_config()
    return JsonResponse(config)


def import_schema(request: HttpRequest) -> JsonResponse:
    """Import LinkML YAML text into editable tables."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    try:
        req = ImportRequest.model_validate(json.loads(request.body))
    except (ValidationError, json.JSONDecodeError) as exc:
        return _bad_request(exc)
    return _create_schema_session(req)


def integration_create_session(request: HttpRequest) -> JsonResponse:
    """Create an editable schema session from host-provided LinkML YAML."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    try:
        req = IntegrationSessionRequest.model_validate(json.loads(request.body))
    except (ValidationError, json.JSONDecodeError) as exc:
        return _bad_request(exc)
    return _create_schema_session(req)


def _create_schema_session(req: ImportRequest) -> JsonResponse:
    """Import LinkML YAML text and create a process-local editing session."""
    try:
        schema, editable_tables, diagnostics = converter.import_yaml(req.yaml)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    editable_tables, sync_diagnostics = table_sync.sync_tables(editable_tables)
    diagnostics.extend(sync_diagnostics)
    schema_name = req.name or schema.get("name") or "schema"
    session = store.create(
        source_yaml=req.yaml,
        schema_name=schema_name,
        tables=editable_tables,
        source_id=getattr(req, "source_id", None),
        metadata=getattr(req, "metadata", None),
    )
    session.diagnostics = diagnostics
    return JsonResponse(
        {
            "session_id": session.session_id,
            "schema_name": session.schema_name,
            "tables": editable_tables,
            "source_id": session.source_id,
            "metadata": session.metadata,
            "diagnostics": [diagnostic.to_dict() for diagnostic in diagnostics],
        }
    )


def import_schema_file(request: HttpRequest) -> JsonResponse:
    """Import an uploaded LinkML YAML file into editable tables."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    file = request.FILES.get("file")
    if file is None:
        return JsonResponse({"detail": "A file is required"}, status=422)
    req = ImportRequest(yaml=file.read().decode("utf-8"), name=file.name)
    return _create_schema_session(req)


def _session_or_404(session_id: str) -> tuple[SchemaSession | None, JsonResponse | None]:
    try:
        return store.get(session_id), None
    except KeyError:
        return None, JsonResponse({"detail": "Unknown session."}, status=404)


def get_session(request: HttpRequest, session_id: str) -> JsonResponse:
    """Return a schema editing session."""
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    session, err = _session_or_404(session_id)
    if err:
        return err
    return JsonResponse(session.to_dict())


def _update_tables(request: HttpRequest, session_id: str) -> JsonResponse:
    try:
        req = TablesRequest.model_validate(json.loads(request.body))
    except (ValidationError, json.JSONDecodeError) as exc:
        return _bad_request(exc)
    try:
        tables, diagnostics = table_sync.sync_tables(req.tables)
        session = store.update_tables(session_id, tables)
        session.diagnostics = diagnostics
    except KeyError:
        return JsonResponse({"detail": "Unknown session."}, status=404)
    return JsonResponse(session.to_dict())


def update_tables(request: HttpRequest, session_id: str) -> JsonResponse:
    """Update a session's editable tables."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    return _update_tables(request, session_id)


def integration_update_tables(request: HttpRequest, session_id: str) -> JsonResponse:
    """Replace editable tables for a host-managed session."""
    if request.method != "PUT":
        return HttpResponseNotAllowed(["PUT"])
    return _update_tables(request, session_id)


def _generate_session_yaml(session_id: str, editable_tables: TableRows | None) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    """Generate LinkML YAML and DataHarmonizer preview schema for a session."""
    session, err = _session_or_404(session_id)
    if err:
        return None, err
    editable_tables = editable_tables if editable_tables is not None else session.tables
    editable_tables, sync_diagnostics = table_sync.sync_tables(editable_tables)
    yaml_text, schema, diagnostics = converter.generate_yaml(editable_tables)
    diagnostics = [*sync_diagnostics, *diagnostics]
    diagnostics.extend(linkml_diagnostics.validate_schema(schema))
    schema_json, compile_diagnostics = dh_compile.compile_schema_json(yaml_text)
    diagnostics.extend(compile_diagnostics)
    session.tables = editable_tables
    session.latest_yaml = yaml_text
    session.latest_schema = schema
    session.diagnostics = diagnostics
    return {
        "yaml": yaml_text,
        "schema": schema,
        "schema_json": schema_json or schema,
        "diagnostics": [diagnostic.to_dict() for diagnostic in diagnostics],
    }, None


def generate(request: HttpRequest, session_id: str) -> JsonResponse:
    """Generate LinkML YAML and preview schema JSON from editable tables."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    tables = None
    if request.body:
        try:
            tables = TablesRequest.model_validate(json.loads(request.body)).tables
        except (ValidationError, json.JSONDecodeError) as exc:
            return _bad_request(exc)
    result, err = _generate_session_yaml(session_id, tables)
    if err:
        return err
    return JsonResponse(result)


def integration_session_yaml(request: HttpRequest, session_id: str) -> JsonResponse:
    """Generate current LinkML YAML for a host-managed session."""
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    result, err = _generate_session_yaml(session_id, None)
    if err:
        return err
    return JsonResponse(result)


def export_schema(request: HttpRequest, session_id: str) -> JsonResponse:
    """Return generated LinkML YAML without writing host project files."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    tables = None
    if request.body:
        try:
            tables = TablesRequest.model_validate(json.loads(request.body)).tables
        except (ValidationError, json.JSONDecodeError) as exc:
            return _bad_request(exc)
    result, err = _generate_session_yaml(session_id, tables)
    if err:
        return err
    return JsonResponse({"yaml": result["yaml"], "diagnostics": result["diagnostics"]})


# ---------------------------------------------------------------------------
# DataHarmonizer preview bundle: on-demand rebuild, polled rather than
# streamed (no event loop under WSGI/gunicorn; also has no current caller —
# see dh_builder_runner.py's docstring and mimicc-ena-submission-assistant's
# own removal of its equivalent SSE endpoint for the same reason).
# ---------------------------------------------------------------------------


def dh_builder_build(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    try:
        req = DhBuildRequest.model_validate(json.loads(request.body))
    except (ValidationError, json.JSONDecodeError) as exc:
        return _bad_request(exc)
    _, err = _session_or_404(req.session_id)
    if err:
        return err
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"session_id": req.session_id, "status": "pending", "lines": [], "result": None}
    return JsonResponse({"job_id": job_id})


def _run_dh_builder_job(job: dict[str, Any]) -> None:
    # Always reach a terminal "done" state, even if a poller is waiting on
    # one and setup (not just the build itself) fails.
    try:
        generated, err = _generate_session_yaml(job["session_id"], None)
        if err is not None:
            job["lines"].append(f"ERROR: unknown session {job['session_id']!r}")
            job["result"] = {"success": False, "exit_code": 1}
            return
        _DH_SCHEMA_CONTAINER_DIR.mkdir(parents=True, exist_ok=True)
        (_DH_SCHEMA_CONTAINER_DIR / "mimicc.yaml").write_text(generated["yaml"])

        gen = dh_builder_runner.iter_dh_builder_logs(
            schema_host_dir=_HOST_DH_SCHEMA_DIR,
            output_host_dir=_HOST_DH_OUTPUT_DIR,
        )
        exit_code: int | None = None
        try:
            while True:
                job["lines"].append(next(gen))
        except StopIteration as si:
            exit_code = si.value
        job["result"] = {"success": exit_code == 0, "exit_code": exit_code}
    except Exception as exc:  # noqa: BLE001
        job["lines"].append(f"ERROR: {exc}")
        job["result"] = {"success": False, "exit_code": 1}
    finally:
        job["status"] = "done"


def dh_builder_build_status(request: HttpRequest, job_id: str) -> JsonResponse:
    """Poll a build job's accumulated log lines and completion status."""
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    job = _jobs.get(job_id)
    if job is None:
        return JsonResponse({"detail": "Job not found"}, status=404)
    if job["status"] == "pending":
        job["status"] = "running"
        threading.Thread(target=_run_dh_builder_job, args=(job,), daemon=True).start()
    since = int(request.GET.get("since", 0) or 0)
    return JsonResponse(
        {
            "lines": job["lines"][since:],
            "next": len(job["lines"]),
            "done": job["status"] == "done",
            "result": job["result"],
        }
    )


def frontend_asset(request: HttpRequest, asset_name: str) -> FileResponse:
    """Serve current Vite chunks for stale hashed asset URLs after rebuilds."""
    asset_path = _resolve_frontend_asset(asset_name)
    if asset_path is None:
        return JsonResponse({"detail": "Asset not found."}, status=404)
    response = FileResponse(asset_path.open("rb"))
    if asset_path.name != asset_name:
        response["Cache-Control"] = "no-store"
    return response


def _frontend_config() -> tuple[dict[str, Any], str | None]:
    """Return frontend config plus a warning if env config could not be parsed."""
    raw = os.environ.get(FRONTEND_CONFIG_ENV)
    config = dict(DEFAULT_FRONTEND_CONFIG)
    if not raw:
        return config, None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return config, f"{FRONTEND_CONFIG_ENV} is not valid JSON: {exc}"
    if not isinstance(parsed, dict):
        return config, f"{FRONTEND_CONFIG_ENV} must be a JSON object."
    for key, value in parsed.items():
        if key in config:
            config[key] = value
    return config, None


def _resolve_frontend_asset(asset_name: str) -> Path | None:
    exact_path = FRONTEND_ASSETS / asset_name
    if exact_path.is_file():
        return exact_path

    suffix = Path(asset_name).suffix
    if suffix not in {".css", ".js"}:
        return None

    for prefix in VITE_HASHED_ASSET_PREFIXES:
        if not asset_name.startswith(prefix):
            continue
        matches = sorted(
            FRONTEND_ASSETS.glob(f"{prefix}*{suffix}"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        return matches[0] if matches else None
    return None


# ---------------------------------------------------------------------------
# Static serving (§3.7): built frontend at "/", rebuilt preview bundle at
# "/dh-preview" — both with an index.html fallback for SPA/directory routing.
# ---------------------------------------------------------------------------


def serve_frontend(request: HttpRequest, path: str = "") -> HttpResponse:
    root = FRONTEND_DIST
    if not root.is_dir():
        # Not built (e.g. test environments) — mirrors the old StaticFiles
        # mount being skipped entirely when the directory doesn't exist.
        return JsonResponse({"detail": "Frontend not built."}, status=404)
    candidate = root / path if path else root / "index.html"
    if not path or not candidate.is_file():
        candidate = root / "index.html"
    return static_serve(request, str(candidate.relative_to(root)), document_root=str(root))


def serve_dh_preview(request: HttpRequest, path: str = "") -> HttpResponse:
    root = _DH_OUTPUT_DIR
    candidate = root / path if path else root / "index.html"
    if not path or not candidate.is_file():
        candidate = root / "index.html"
    if not candidate.is_file():
        return JsonResponse({"detail": "Preview bundle not built."}, status=404)
    return static_serve(request, str(candidate.relative_to(root)), document_root=str(root))

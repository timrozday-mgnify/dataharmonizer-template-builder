"""FastAPI application for the DataHarmonizer template builder."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from dataharmonizer_template_builder import dh_builder_runner, dh_compile
from dataharmonizer_template_builder.conversion import ConversionService
from dataharmonizer_template_builder.models import Diagnostic, TableRows
from dataharmonizer_template_builder.sessions import store
from dataharmonizer_template_builder import validation


app = FastAPI(title="DataHarmonizer Template Builder")
converter = ConversionService()
_executor = ThreadPoolExecutor(max_workers=4)
_jobs: dict[str, dict[str, Any]] = {}
_HOST_DH_OUTPUT_DIR = os.environ.get("HOST_DH_OUTPUT_DIR", "dhtb-dh-output")
_HOST_DH_SCHEMA_DIR = os.environ.get("HOST_DH_SCHEMA_DIR", "dhtb-dh-schema")
_DH_SCHEMA_CONTAINER_DIR = Path(os.environ.get("DH_SCHEMA_CONTAINER_DIR", "/dh-schema"))
_DH_OUTPUT_DIR = Path("dh-output")
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_static_cache_headers(request, call_next):
    """Avoid stale HTML keeping references to old Vite asset hashes."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store"
    return response


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


@app.get("/api/health")
def health() -> dict[str, Any]:
    """Return backend health and optional tool status."""
    _, frontend_config_warning = _frontend_config()
    return {
        "ok": True,
        "docker_available": dh_compile.docker_available(),
        "frontend_config_warning": frontend_config_warning,
    }


@app.get("/api/frontend-config")
def frontend_config() -> dict[str, Any]:
    """Return backend-owned frontend feature flags for standalone or embedded use."""
    config, _ = _frontend_config()
    return config


@app.post("/api/schemas/import")
def import_schema(request: ImportRequest) -> dict[str, Any]:
    """Import LinkML YAML text into editable tables."""
    return _create_schema_session(request)


@app.post("/api/integrations/sessions")
def integration_create_session(request: IntegrationSessionRequest) -> dict[str, Any]:
    """Create an editable schema session from host-provided LinkML YAML."""
    return _create_schema_session(request)


def _create_schema_session(request: ImportRequest) -> dict[str, Any]:
    """Import LinkML YAML text and create a process-local editing session."""
    try:
        schema, editable_tables, diagnostics = converter.import_yaml(request.yaml)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    schema_name = request.name or schema.get("name") or "schema"
    session = store.create(
        source_yaml=request.yaml,
        schema_name=schema_name,
        tables=editable_tables,
        source_id=getattr(request, "source_id", None),
        metadata=getattr(request, "metadata", None),
    )
    session.diagnostics = diagnostics
    return {
        "session_id": session.session_id,
        "schema_name": session.schema_name,
        "tables": editable_tables,
        "source_id": session.source_id,
        "metadata": session.metadata,
        "diagnostics": [diagnostic.to_dict() for diagnostic in diagnostics],
    }


if importlib.util.find_spec("multipart") is not None:

    @app.post("/api/schemas/import-file")
    async def import_schema_file(file: UploadFile = File(...)) -> dict[str, Any]:
        """Import an uploaded LinkML YAML file into editable tables."""
        content = await file.read()
        return import_schema(ImportRequest(yaml=content.decode("utf-8"), name=file.filename))


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    """Return a schema editing session."""
    try:
        return store.get(session_id).to_dict()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown session.") from exc


@app.post("/api/sessions/{session_id}/tables")
def update_tables(session_id: str, request: TablesRequest) -> dict[str, Any]:
    """Update a session's editable tables."""
    try:
        session = store.update_tables(session_id, request.tables)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown session.") from exc
    return session.to_dict()


@app.put("/api/integrations/sessions/{session_id}/tables")
def integration_update_tables(session_id: str, request: TablesRequest) -> dict[str, Any]:
    """Replace editable tables for a host-managed session."""
    return update_tables(session_id, request)


@app.post("/api/sessions/{session_id}/generate")
def generate(session_id: str, request: TablesRequest | None = None) -> dict[str, Any]:
    """Generate LinkML YAML and preview schema JSON from editable tables."""
    return _generate_session_yaml(session_id, request.tables if request else None)


@app.get("/api/integrations/sessions/{session_id}/yaml")
def integration_session_yaml(session_id: str) -> dict[str, Any]:
    """Generate current LinkML YAML for a host-managed session."""
    return _generate_session_yaml(session_id, None)


def _generate_session_yaml(session_id: str, editable_tables: TableRows | None) -> dict[str, Any]:
    """Generate LinkML YAML and DataHarmonizer preview schema for a session."""
    session = _session_or_404(session_id)
    editable_tables = editable_tables if editable_tables is not None else session.tables
    yaml_text, schema, diagnostics = converter.generate_yaml(editable_tables)
    diagnostics.extend(validation.validate_schema(schema))
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
    }


@app.post("/api/sessions/{session_id}/export")
def export_schema(session_id: str, request: TablesRequest | None = None) -> dict[str, Any]:
    """Return generated LinkML YAML without writing host project files."""
    generated = generate(session_id, request)
    return {"yaml": generated["yaml"], "diagnostics": generated["diagnostics"]}


# ---------------------------------------------------------------------------
# DataHarmonizer preview bundle: on-demand rebuild (SSE)
# ---------------------------------------------------------------------------


@app.post("/api/dh-builder/build")
def dh_builder_build(req: DhBuildRequest) -> dict[str, str]:
    # Rebuilding the preview bundle spawns a sibling container on the host
    # Docker daemon and writes the globally-served bundle.
    _session_or_404(req.session_id)
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"config": req.model_dump(), "status": "pending", "results": []}
    return {"job_id": job_id}


@app.get("/api/dh-builder/build/stream/{job_id}")
async def dh_builder_build_stream(job_id: str) -> EventSourceResponse:
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = _jobs[job_id]

    async def event_generator():
        if job["status"] != "pending":
            yield {"data": json.dumps({"error": "Job already started or completed"})}
            return
        job["status"] = "running"
        session_id = job["config"]["session_id"]

        generated = _generate_session_yaml(session_id, None)
        _DH_SCHEMA_CONTAINER_DIR.mkdir(parents=True, exist_ok=True)
        (_DH_SCHEMA_CONTAINER_DIR / "mimicc.yaml").write_text(generated["yaml"])

        loop = asyncio.get_event_loop()
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

        def _produce() -> None:
            gen = dh_builder_runner.iter_dh_builder_logs(
                schema_host_dir=_HOST_DH_SCHEMA_DIR,
                output_host_dir=_HOST_DH_OUTPUT_DIR,
            )
            exit_code: int | None = None
            try:
                while True:
                    line = next(gen)
                    loop.call_soon_threadsafe(queue.put_nowait, ("line", line))
            except StopIteration as si:
                exit_code = si.value
            except Exception as exc:  # noqa: BLE001
                loop.call_soon_threadsafe(queue.put_nowait, ("line", f"ERROR: {exc}"))
                exit_code = 1
            result = {"success": exit_code == 0, "exit_code": exit_code}
            loop.call_soon_threadsafe(queue.put_nowait, ("__DONE__", result))

        loop.run_in_executor(_executor, _produce)

        while True:
            kind, payload = await queue.get()
            ts = datetime.now(UTC).isoformat()
            if kind == "__DONE__":
                job["status"] = "done"
                job["results"] = payload
                yield {"data": json.dumps({"done": True, "result": payload, "ts": ts})}
                break
            yield {"data": json.dumps({"line": payload, "ts": ts})}

    return EventSourceResponse(event_generator())


@app.get("/assets/{asset_name}")
def frontend_asset(asset_name: str) -> FileResponse:
    """Serve current Vite chunks for stale hashed asset URLs after rebuilds."""
    asset_path = _resolve_frontend_asset(asset_name)
    if asset_path is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    response = FileResponse(asset_path)
    if asset_path.name != asset_name:
        response.headers["Cache-Control"] = "no-store"
    return response


def _session_or_404(session_id: str):
    try:
        return store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown session.") from exc


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


_DH_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/dh-preview", StaticFiles(directory=_DH_OUTPUT_DIR, html=True), name="dh-preview")

try:
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
except RuntimeError:
    pass

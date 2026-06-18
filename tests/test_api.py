import pytest

fastapi = pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from dataharmonizer_template_builder import api
from dataharmonizer_template_builder.api import app
from tests.test_tables import SAMPLE_SCHEMA


def test_import_generate_api() -> None:
    client = TestClient(app)

    imported = client.post("/api/schemas/import", json={"yaml": SAMPLE_SCHEMA})
    assert imported.status_code == 200
    body = imported.json()

    generated = client.post(
        f"/api/sessions/{body['session_id']}/generate",
        json={"tables": body["tables"]},
    )
    assert generated.status_code == 200
    assert "StatusMenu" in generated.json()["yaml"]


def test_stale_vite_asset_hash_resolves_to_current_chunk(tmp_path, monkeypatch) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    current_jquery = assets / "jquery-current.js"
    current_jquery.write_text("export default {};", encoding="utf-8")
    monkeypatch.setattr(api, "FRONTEND_ASSETS", assets)

    assert api._resolve_frontend_asset("jquery-oldhash.js") == current_jquery
    assert api._resolve_frontend_asset("missing-image-oldhash.png") is None

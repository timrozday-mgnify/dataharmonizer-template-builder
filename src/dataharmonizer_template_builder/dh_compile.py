"""Compile generated LinkML into DataHarmonizer-previewable schema JSON."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from linkml_lib import dataharmonizer_compile

from dataharmonizer_template_builder.models import Diagnostic


def compile_schema_json(yaml_text: str, template_name: str = "preview") -> tuple[dict[str, Any], list[Diagnostic]]:
    """Return DataHarmonizer schema JSON for a LinkML schema."""
    try:
        return dataharmonizer_compile.compile_yaml_text(yaml_text), []
    except Exception as exc:
        fallback_diagnostic = Diagnostic(
            "warning",
            f"Python DataHarmonizer schema compilation failed; trying DataHarmonizer script fallback. {exc}",
        )

    dataharmonizer_dir = Path(os.environ.get("DATAHARMONIZER_DIR", "../DataHarmonizer")).resolve()
    compiler = dataharmonizer_dir / "script" / "linkml.py"
    if not compiler.exists():
        return {}, [
            fallback_diagnostic,
            Diagnostic(
                "warning",
                f"DataHarmonizer compiler not found at {compiler}; preview will use raw LinkML.",
            ),
        ]

    with tempfile.TemporaryDirectory(prefix="dh-template-builder-preview-") as tmp_dir:
        template_dir = Path(tmp_dir) / template_name
        source_dir = template_dir / "source"
        source_dir.mkdir(parents=True)
        schema_path = source_dir / f"{template_name}.yaml"
        schema_path.write_text(yaml_text, encoding="utf-8")
        (template_dir / "export.js").write_text("export default {};\n", encoding="utf-8")
        command = [sys.executable, str(compiler), "--input", f"source/{template_name}.yaml"]
        try:
            subprocess.run(command, cwd=template_dir, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            return {}, [
                fallback_diagnostic,
                Diagnostic("warning", f"DataHarmonizer schema compilation failed: {exc.stderr}"),
            ]
        schema_json_path = template_dir / "schema.json"
        if not schema_json_path.exists():
            return {}, [
                fallback_diagnostic,
                Diagnostic("warning", "DataHarmonizer compiler did not create schema.json."),
            ]
        return json.loads(schema_json_path.read_text(encoding="utf-8")), [fallback_diagnostic]


def docker_available() -> bool:
    """Return whether Docker appears available for optional bundle builds."""
    return shutil.which("docker") is not None

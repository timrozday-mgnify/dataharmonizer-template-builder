"""Schemasheets conversion service."""

from __future__ import annotations

import csv
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from dataharmonizer_template_builder import linkml_io
from dataharmonizer_template_builder.models import Diagnostic, TableRows
from dataharmonizer_template_builder import tables


class ConversionService:
    """Convert LinkML schemas to editable tables and back."""

    def import_yaml(self, yaml_text: str) -> tuple[dict[str, Any], TableRows, list[Diagnostic]]:
        """Return schema and editable tables from LinkML YAML."""
        schema = linkml_io.load_yaml_text(yaml_text)
        diagnostics = _schemasheets_available_diagnostics()
        return schema, tables.schema_to_tables(schema), diagnostics

    def generate_yaml(
        self,
        editable_tables: TableRows,
    ) -> tuple[str, dict[str, Any], list[Diagnostic]]:
        """Return LinkML YAML and schema dictionary from editable tables."""
        schema, diagnostics = tables.tables_to_schema(editable_tables)
        yaml_text = linkml_io.dump_yaml(schema)
        if shutil.which("sheets2linkml"):
            _, cli_diagnostics = _try_sheets2linkml(editable_tables)
            diagnostics.extend(cli_diagnostics)
        return yaml_text, schema, diagnostics


def _schemasheets_available_diagnostics() -> list[Diagnostic]:
    if shutil.which("linkml2sheets") and shutil.which("sheets2linkml"):
        return []
    return [
        Diagnostic(
            level="info",
            message=(
                "Schemasheets CLI was not found; using built-in Schemasheets-shaped "
                "table conversion."
            ),
        )
    ]


def _try_sheets2linkml(editable_tables: TableRows) -> tuple[str | None, list[Diagnostic]]:
    diagnostics: list[Diagnostic] = []
    with tempfile.TemporaryDirectory(prefix="dh-template-builder-sheets-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sheet_paths = _write_tsvs(tmp_path, editable_tables)
        output_path = tmp_path / "schema.yaml"
        command = [
            "sheets2linkml",
            "--unique-slots",
            *[str(path) for path in sheet_paths],
            "-o",
            str(output_path),
        ]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            diagnostics.append(
                Diagnostic(
                    level="warning",
                    message=f"Schemasheets CLI generation failed; used built-in generator. {exc.stderr}",
                )
            )
            return None, diagnostics
        return output_path.read_text(encoding="utf-8"), diagnostics


def _write_tsvs(base_dir: Path, editable_tables: TableRows) -> list[Path]:
    specs = tables.table_specs()
    paths = []
    for table_name, rows in editable_tables.items():
        if table_name not in specs:
            continue
        path = base_dir / f"{table_name}.tsv"
        header = specs[table_name][0]
        descriptor = specs[table_name][1]
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file, delimiter="\t")
            writer.writerow(header)
            writer.writerow(descriptor)
            for row in rows:
                writer.writerow([_cell_for_tsv(table_name, column, row) for column in header])
        paths.append(path)
    return paths


def _cell_for_tsv(table_name: str, column: str, row: dict[str, object]) -> object:
    if table_name == tables.CLASS_TABLE and column == "slots":
        return ""
    return row.get(column, "")

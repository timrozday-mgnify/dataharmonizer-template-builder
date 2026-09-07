"""Editable table conversion service."""

from __future__ import annotations

from typing import Any

from linkml_lib import edit_tables
from linkml_lib import io as linkml_io

from dataharmonizer_template_builder.models import Diagnostic, TableRows


class ConversionService:
    """Convert LinkML schemas to editable tables and back."""

    def import_yaml(self, yaml_text: str) -> tuple[dict[str, Any], TableRows, list[Diagnostic]]:
        """Return schema and editable tables from LinkML YAML."""
        schema = linkml_io.load_yaml_text(yaml_text)
        return schema, edit_tables.schema_to_tables(schema), []

    def generate_yaml(
        self,
        editable_tables: TableRows,
    ) -> tuple[str, dict[str, Any], list[Diagnostic]]:
        """Return LinkML YAML and schema dictionary from editable tables."""
        schema, diagnostics = edit_tables.tables_to_schema(editable_tables)
        yaml_text = linkml_io.dump_yaml(schema)
        return yaml_text, schema, diagnostics

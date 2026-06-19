"""Shared API and session models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


JsonDict = dict[str, Any]
TableRows = dict[str, list[JsonDict]]


@dataclass
class Diagnostic:
    """Describe a schema, table, conversion, or validation issue."""

    level: str
    message: str
    table: str | None = None
    row: int | None = None
    column: str | None = None
    path: str | None = None

    def to_dict(self) -> JsonDict:
        """Return a JSON-serializable diagnostic."""
        return {
            "level": self.level,
            "message": self.message,
            "table": self.table,
            "row": self.row,
            "column": self.column,
            "path": self.path,
        }


@dataclass
class SchemaSession:
    """Hold one editable schema session in memory."""

    session_id: str
    source_yaml: str
    schema_name: str
    tables: TableRows
    source_id: str | None = None
    metadata: JsonDict = field(default_factory=dict)
    latest_yaml: str | None = None
    latest_schema: JsonDict | None = None
    diagnostics: list[Diagnostic] = field(default_factory=list)

    def to_dict(self) -> JsonDict:
        """Return a JSON-serializable session summary."""
        return {
            "session_id": self.session_id,
            "schema_name": self.schema_name,
            "tables": self.tables,
            "source_id": self.source_id,
            "metadata": self.metadata,
            "latest_yaml": self.latest_yaml,
            "diagnostics": [diagnostic.to_dict() for diagnostic in self.diagnostics],
        }

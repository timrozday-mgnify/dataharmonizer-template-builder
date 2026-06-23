"""Compatibility wrapper for schema diagnostics."""

from __future__ import annotations

from typing import Any

from linkml_lib import diagnostics as linkml_diagnostics

from dataharmonizer_template_builder.models import Diagnostic


def validate_schema(schema: dict[str, Any]) -> list[Diagnostic]:
    """Return structural diagnostics for a generated LinkML schema."""
    return [_to_app_diagnostic(diagnostic) for diagnostic in linkml_diagnostics.validate_schema(schema)]


def _to_app_diagnostic(diagnostic: linkml_diagnostics.Diagnostic) -> Diagnostic:
    return Diagnostic(
        diagnostic.level,
        diagnostic.message,
        diagnostic.table,
        diagnostic.row,
        path=diagnostic.path,
    )

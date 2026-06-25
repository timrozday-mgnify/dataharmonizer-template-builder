"""Compatibility wrapper for editable LinkML table conversion."""

from __future__ import annotations

from linkml_lib.edit_tables import (  # noqa: F401
    ANNOTATION_TABLE,
    CLASS_TABLE,
    ENUM_TABLE,
    PERMISSIBLE_VALUE_TABLE,
    PREFIX_TABLE,
    SCHEMA_TABLE,
    SLOT_TABLE,
    schema_to_tables,
    tables_to_schema,
)
from linkml_lib.edit_tables import table_specs as _linkml_table_specs


def table_specs() -> dict[str, list[list[str]]]:
    """Return table specs with Schemasheets-compatible annotation columns."""
    specs = _linkml_table_specs()
    slots = [list(row) for row in specs[SLOT_TABLE]]
    descriptor = slots[1]
    descriptor[slots[0].index("annotation_id")] = "> annotations: {inner_key: id}"
    descriptor[slots[0].index("annotation_default_unit")] = (
        "> annotations: {inner_key: default_unit}"
    )
    specs[SLOT_TABLE] = slots
    return specs

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
    table_specs,
    tables_to_schema,
)

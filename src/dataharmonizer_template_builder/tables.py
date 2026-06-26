"""Compatibility wrapper for editable LinkML table conversion."""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from typing import Any

from linkml_lib.edit_tables import (  # noqa: F401
    ANNOTATION_TABLE,
    CLASS_TABLE,
    ENUM_TABLE,
    PERMISSIBLE_VALUE_TABLE,
    PREFIX_TABLE,
    SCHEMA_TABLE,
    SLOT_TABLE,
)
from linkml_lib.edit_tables import schema_to_tables as _linkml_schema_to_tables
from linkml_lib.edit_tables import table_specs as _linkml_table_specs
from linkml_lib.edit_tables import tables_to_schema as _linkml_tables_to_schema

JsonDict = dict[str, Any]
TableRows = dict[str, list[JsonDict]]
ANNOTATION_COLUMN_PREFIX = "annotation_"
LEGACY_SLOT_ANNOTATION_KEYS = {
    "mimicc_default_unit": "default_unit",
}


def schema_to_tables(schema: Mapping[str, Any]) -> TableRows:
    """Return editable tables with all slot annotations projected as columns."""
    tables = _linkml_schema_to_tables(schema)
    _project_slot_annotation_columns(tables)
    return tables


def tables_to_schema(tables: Mapping[str, list[JsonDict]]) -> tuple[dict[str, Any], list[Any]]:
    """Build a LinkML schema from tables with dynamic slot annotation columns."""
    prepared = _tables_with_slot_annotation_rows(tables)
    return _linkml_tables_to_schema(prepared)


def table_specs(tables: Mapping[str, list[JsonDict]] | None = None) -> dict[str, list[list[str]]]:
    """Return table specs with Schemasheets-compatible annotation columns."""
    specs = _linkml_table_specs()
    slots = [list(row) for row in specs[SLOT_TABLE]]
    for column in _slot_annotation_columns(tables):
        if column not in slots[0]:
            slots[0].append(column)
            slots[1].append("")
    descriptor = slots[1]
    for column in _slot_annotation_columns(tables):
        annotation_key = json.dumps(_annotation_key_for_column(column))
        descriptor[slots[0].index(column)] = (
            f"> annotations: {{inner_key: {annotation_key}}}"
        )
    specs[SLOT_TABLE] = slots
    return specs


def _project_slot_annotation_columns(tables: TableRows) -> None:
    slot_rows_by_name = {
        _cell(row.get("slot")): row for row in tables.get(SLOT_TABLE, []) if _cell(row.get("slot"))
    }
    for row in tables.get(ANNOTATION_TABLE, []):
        if _cell(row.get("element_type")) != "slot":
            continue
        slot_row = slot_rows_by_name.get(_cell(row.get("element")))
        key = _normalized_annotation_key(_cell(row.get("key")))
        if slot_row is not None and key:
            slot_row[_annotation_column_for_key(key)] = row.get("value", "")


def _tables_with_slot_annotation_rows(tables: Mapping[str, list[JsonDict]]) -> TableRows:
    prepared = copy.deepcopy(dict(tables))
    annotation_rows = prepared.setdefault(ANNOTATION_TABLE, [])
    for slot_row in prepared.get(SLOT_TABLE, []):
        slot_name = _cell(slot_row.get("slot"))
        if not slot_name:
            continue
        slot_columns = _slot_annotation_columns_for_row(slot_row)
        annotation_rows[:] = [
            row
            for row in annotation_rows
            if not (
                _cell(row.get("element_type")) == "slot"
                and _cell(row.get("element")) == slot_name
                and _annotation_column_for_key(_normalized_annotation_key(_cell(row.get("key"))))
                in slot_columns
            )
        ]
        for column in slot_columns:
            value = slot_row.get(column)
            if value in (None, ""):
                continue
            annotation_rows.append(
                {
                    "element_type": "slot",
                    "element": slot_name,
                    "key": _annotation_key_for_column(column),
                    "value": value,
                }
            )
    return prepared


def _slot_annotation_columns(tables: Mapping[str, list[JsonDict]] | None = None) -> list[str]:
    columns = ["annotation_id", "annotation_default_unit"]
    if tables is not None:
        for row in tables.get(SLOT_TABLE, []):
            columns.extend(_slot_annotation_columns_for_row(row))
        for row in tables.get(ANNOTATION_TABLE, []):
            if _cell(row.get("element_type")) == "slot":
                columns.append(_annotation_column_for_key(_normalized_annotation_key(_cell(row.get("key")))))
    return list(dict.fromkeys(column for column in columns if column != ANNOTATION_COLUMN_PREFIX))


def _slot_annotation_columns_for_row(row: Mapping[str, Any]) -> list[str]:
    return [
        column
        for column in row
        if column.startswith(ANNOTATION_COLUMN_PREFIX)
        and column != ANNOTATION_COLUMN_PREFIX
    ]


def _annotation_column_for_key(key: str) -> str:
    return f"{ANNOTATION_COLUMN_PREFIX}{key}"


def _annotation_key_for_column(column: str) -> str:
    return _normalized_annotation_key(column.removeprefix(ANNOTATION_COLUMN_PREFIX))


def _normalized_annotation_key(key: str) -> str:
    return LEGACY_SLOT_ANNOTATION_KEYS.get(key, key)


def _cell(value: Any) -> str:
    return "" if value is None else str(value).strip()

"""Synchronize redundant references across editable Schemasheets tables."""

from __future__ import annotations

import copy
import json
from collections.abc import Iterable, Mapping
from typing import Any

import yaml

from dataharmonizer_template_builder.models import Diagnostic, JsonDict, TableRows

CLASS_TABLE = "classes"
SLOT_TABLE = "slots"
ENUM_TABLE = "enums"
PERMISSIBLE_VALUE_TABLE = "permissible_values"
ANNOTATION_TABLE = "annotations"

SLOT_ANNOTATION_COLUMN_PREFIX = "Annotation: "
LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX = "annotation_"

LEGACY_SLOT_ANNOTATION_COLUMNS = {
    "mimicc_default_unit": "default_unit",
}

LEGACY_SLOT_ROW_COLUMNS = {
    "annotation_mimicc_default_unit": "Annotation: default_unit",
}


def sync_tables(
    tables: TableRows,
    source_table: str | None = None,
) -> tuple[TableRows, list[Diagnostic]]:
    """Return tables with redundant references synchronized."""
    synced = copy.deepcopy(tables)
    synced.setdefault(CLASS_TABLE, [])
    synced.setdefault(SLOT_TABLE, [])
    synced.setdefault(ENUM_TABLE, [])
    synced.setdefault(PERMISSIBLE_VALUE_TABLE, [])
    synced.setdefault(ANNOTATION_TABLE, [])

    _sync_class_slots(synced)
    _sync_slot_annotations(synced, source_table)
    diagnostics = _sync_enum_annotations(synced, source_table)
    diagnostics.extend(_reference_diagnostics(synced))
    return synced, diagnostics


def _sync_class_slots(tables: TableRows) -> None:
    slots_by_class: dict[str, list[str]] = {}
    for row in tables[SLOT_TABLE]:
        class_name = _cell(row.get("class"))
        slot_name = _cell(row.get("slot"))
        if class_name and slot_name:
            slots_by_class.setdefault(class_name, []).append(slot_name)

    for row in tables[CLASS_TABLE]:
        class_name = _cell(row.get("class"))
        if class_name in slots_by_class:
            row["slots"] = "; ".join(slots_by_class[class_name])


def _sync_slot_annotations(tables: TableRows, source_table: str | None) -> None:
    annotation_rows = tables[ANNOTATION_TABLE]
    slot_rows_by_name = {
        _cell(row.get("slot")): row for row in tables[SLOT_TABLE] if _cell(row.get("slot"))
    }
    _migrate_legacy_slot_row_columns(slot_rows_by_name.values())
    _migrate_legacy_slot_annotations(annotation_rows)

    if source_table != ANNOTATION_TABLE:
        for slot_name, slot_row in slot_rows_by_name.items():
            for row_key in _slot_annotation_columns(slot_row):
                annotation_key = _annotation_key_for_column(row_key)
                value = _cell(slot_row.get(row_key))
                _upsert_annotation(annotation_rows, "slot", slot_name, annotation_key, value)
    else:
        for slot_row in slot_rows_by_name.values():
            for row_key in _slot_annotation_columns(slot_row):
                slot_row[row_key] = ""

    for row in annotation_rows:
        if _cell(row.get("element_type")) != "slot":
            continue
        slot_row = slot_rows_by_name.get(_cell(row.get("element")))
        row_key = _annotation_column_for_key(_cell(row.get("key")))
        if slot_row is not None and row_key:
            slot_row[row_key] = row.get("value", "")


def _sync_enum_annotations(tables: TableRows, source_table: str | None) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    annotation_rows = tables[ANNOTATION_TABLE]
    enum_rows_by_name = {
        _cell(row.get("enum")): row for row in tables[ENUM_TABLE] if _cell(row.get("enum"))
    }

    if source_table != ANNOTATION_TABLE:
        for row_index, (enum_name, enum_row) in enumerate(enum_rows_by_name.items(), start=1):
            parsed, ok = _parse_mapping_cell(enum_row.get("annotations"))
            if not ok:
                diagnostics.append(
                    Diagnostic(
                        "warning",
                        f"Enum {enum_name} has malformed annotations mapping.",
                        ENUM_TABLE,
                        row_index,
                        "annotations",
                    )
                )
                continue
            for key, value in parsed.items():
                _upsert_annotation(annotation_rows, "enum", enum_name, str(key), str(value))

    for row in annotation_rows:
        if _cell(row.get("element_type")) != "enum":
            continue
        enum_row = enum_rows_by_name.get(_cell(row.get("element")))
        key = _cell(row.get("key"))
        if enum_row is None or not key:
            continue
        parsed, _ = _parse_mapping_cell(enum_row.get("annotations"))
        parsed[key] = row.get("value", "")
        enum_row["annotations"] = json.dumps(parsed, ensure_ascii=False) if parsed else ""

    return diagnostics


def _reference_diagnostics(tables: TableRows) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    class_names = {
        _cell(row.get("class")) for row in tables[CLASS_TABLE] if _cell(row.get("class"))
    }
    slot_names = {_cell(row.get("slot")) for row in tables[SLOT_TABLE] if _cell(row.get("slot"))}
    enum_names = {_cell(row.get("enum")) for row in tables[ENUM_TABLE] if _cell(row.get("enum"))}

    for index, row in enumerate(tables[SLOT_TABLE], start=1):
        class_name = _cell(row.get("class"))
        if class_name and class_name not in class_names:
            diagnostics.append(
                Diagnostic(
                    "warning",
                    f"Slot references missing class {class_name}.",
                    SLOT_TABLE,
                    index,
                    "class",
                )
            )
        enum_name = _cell(row.get("range"))
        if enum_name.endswith("Menu") and enum_name not in enum_names:
            diagnostics.append(
                Diagnostic(
                    "warning",
                    f"Slot references missing enum {enum_name}.",
                    SLOT_TABLE,
                    index,
                    "range",
                )
            )

    for index, row in enumerate(tables[PERMISSIBLE_VALUE_TABLE], start=1):
        enum_name = _cell(row.get("enum"))
        if enum_name and enum_name not in enum_names:
            diagnostics.append(
                Diagnostic(
                    "warning",
                    f"Permissible value references missing enum {enum_name}.",
                    PERMISSIBLE_VALUE_TABLE,
                    index,
                    "enum",
                )
            )

    for index, row in enumerate(tables[ANNOTATION_TABLE], start=1):
        element_type = _cell(row.get("element_type"))
        element = _cell(row.get("element"))
        if not element_type or not element:
            continue
        if element_type == "class" and element not in class_names:
            diagnostics.append(
                Diagnostic("warning", "Annotation target was not found.", ANNOTATION_TABLE, index)
            )
        elif element_type == "slot" and element not in slot_names:
            diagnostics.append(
                Diagnostic("warning", "Annotation target was not found.", ANNOTATION_TABLE, index)
            )
        elif element_type == "enum" and element not in enum_names:
            diagnostics.append(
                Diagnostic("warning", "Annotation target was not found.", ANNOTATION_TABLE, index)
            )

    return diagnostics


def _upsert_annotation(
    rows: list[JsonDict],
    element_type: str,
    element: str,
    key: str,
    value: Any,
) -> None:
    match = next(
        (
            row
            for row in rows
            if _cell(row.get("element_type")) == element_type
            and _cell(row.get("element")) == element
            and _cell(row.get("key")) == key
        ),
        None,
    )
    if value in (None, ""):
        if match is not None:
            rows.remove(match)
        return
    if match is None:
        rows.append({"element_type": element_type, "element": element, "key": key, "value": value})
    else:
        match["value"] = value


def _migrate_legacy_slot_annotations(rows: list[JsonDict]) -> None:
    for row in rows:
        if _cell(row.get("element_type")) != "slot":
            continue
        key = LEGACY_SLOT_ANNOTATION_COLUMNS.get(_cell(row.get("key")))
        if key:
            row["key"] = key


def _migrate_legacy_slot_row_columns(rows: Iterable[JsonDict]) -> None:
    for row in rows:
        _migrate_legacy_slot_annotation_columns(row)
        for legacy_key, row_key in LEGACY_SLOT_ROW_COLUMNS.items():
            if not _cell(row.get(row_key)) and _cell(row.get(legacy_key)):
                row[row_key] = row[legacy_key]
            row.pop(legacy_key, None)


def _parse_mapping_cell(value: Any) -> tuple[dict[str, Any], bool]:
    if not value:
        return {}, True
    if isinstance(value, Mapping):
        return dict(value), True
    try:
        parsed = yaml.safe_load(str(value))
    except yaml.YAMLError:
        return {}, False
    return (dict(parsed), True) if isinstance(parsed, Mapping) else ({}, False)


def _cell(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _slot_annotation_columns(row: Mapping[str, Any]) -> list[str]:
    return [
        _annotation_column_for_key(_annotation_key_for_column(key))
        for key in row
        if _is_slot_annotation_column(key)
    ]


def _annotation_column_for_key(key: str) -> str:
    normalized_key = LEGACY_SLOT_ANNOTATION_COLUMNS.get(key, key)
    return f"{SLOT_ANNOTATION_COLUMN_PREFIX}{normalized_key}" if normalized_key else ""


def _annotation_key_for_column(column: str) -> str:
    if column.startswith(SLOT_ANNOTATION_COLUMN_PREFIX):
        key = column.removeprefix(SLOT_ANNOTATION_COLUMN_PREFIX)
    else:
        key = column.removeprefix(LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX)
    return LEGACY_SLOT_ANNOTATION_COLUMNS.get(key, key)


def _migrate_legacy_slot_annotation_columns(row: JsonDict) -> None:
    for column in list(row):
        if not _is_legacy_slot_annotation_column(column):
            continue
        canonical_column = _annotation_column_for_key(_annotation_key_for_column(column))
        if not _cell(row.get(canonical_column)) and _cell(row.get(column)):
            row[canonical_column] = row[column]
        row.pop(column, None)


def _is_slot_annotation_column(column: str) -> bool:
    return (
        column.startswith(SLOT_ANNOTATION_COLUMN_PREFIX)
        and column != SLOT_ANNOTATION_COLUMN_PREFIX
    ) or _is_legacy_slot_annotation_column(column)


def _is_legacy_slot_annotation_column(column: str) -> bool:
    return (
        column.startswith(LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX)
        and column != LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX
    )

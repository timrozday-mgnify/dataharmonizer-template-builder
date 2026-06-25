from dataharmonizer_template_builder import linkml_io
from dataharmonizer_template_builder.table_sync import sync_tables
from dataharmonizer_template_builder.tables import schema_to_tables
from tests.test_tables import SAMPLE_SCHEMA


def test_slot_annotation_columns_sync_to_annotation_rows() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    slot = next(row for row in tables["slots"] if row["slot"] == "sample_id")
    slot["annotation_id"] = "updated"

    synced, diagnostics = sync_tables(tables, source_table="slots")

    assert diagnostics == []
    assert {
        "element_type": "slot",
        "element": "sample_id",
        "key": "id",
        "value": "updated",
    } in synced["annotations"]


def test_source_annotation_row_is_not_a_slot_shortcut_column() -> None:
    tables = schema_to_tables(
        linkml_io.load_yaml_text(
            """
id: https://example.org/test
name: test
classes:
  Test:
    slots:
    - sample_id
slots:
  sample_id:
    annotations:
      source: legacy
"""
        )
    )
    row = next(
        row
        for row in tables["annotations"]
        if row["element_type"] == "slot" and row["element"] == "sample_id" and row["key"] == "source"
    )
    row["value"] = "updated"

    synced, diagnostics = sync_tables(tables, source_table="annotations")
    slot = next(row for row in synced["slots"] if row["slot"] == "sample_id")

    assert diagnostics == []
    assert "annotation_source" not in slot


def test_annotation_rows_sync_to_slot_annotation_columns() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    row = next(
        row
        for row in tables["annotations"]
        if row["element_type"] == "slot" and row["element"] == "sample_id" and row["key"] == "id"
    )
    row["value"] = "sample identifier"

    synced, diagnostics = sync_tables(tables, source_table="annotations")
    slot = next(row for row in synced["slots"] if row["slot"] == "sample_id")

    assert diagnostics == []
    assert slot["annotation_id"] == "sample identifier"


def test_legacy_default_unit_annotation_syncs_to_default_unit_column() -> None:
    tables = schema_to_tables(
        linkml_io.load_yaml_text(
            """
id: https://example.org/test
name: test
classes:
  Test:
    slots:
    - sample_id
slots:
  sample_id:
    annotations:
      mimicc_default_unit: mL
"""
        )
    )

    synced, diagnostics = sync_tables(tables, source_table="annotations")
    slot = next(row for row in synced["slots"] if row["slot"] == "sample_id")

    assert diagnostics == []
    assert slot["annotation_default_unit"] == "mL"
    assert {
        "element_type": "slot",
        "element": "sample_id",
        "key": "default_unit",
        "value": "mL",
    } in synced["annotations"]
    assert all(row["key"] != "mimicc_default_unit" for row in synced["annotations"])


def test_enum_annotations_sync_to_annotation_rows() -> None:
    tables = schema_to_tables(
        linkml_io.load_yaml_text(
            """
id: https://example.org/test
name: test
enums:
  StatusMenu:
    annotations:
      id: StatusMenu
    permissible_values:
      ready:
        text: ready
"""
        )
    )

    synced, diagnostics = sync_tables(tables)

    assert diagnostics == []
    assert {
        "element_type": "enum",
        "element": "StatusMenu",
        "key": "id",
        "value": "StatusMenu",
    } in synced["annotations"]


def test_class_slots_are_derived_from_ordered_slot_rows() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    class_row = next(row for row in tables["classes"] if row["class"] == "Test")
    class_row["slots"] = "stale"

    synced, diagnostics = sync_tables(tables)

    assert diagnostics == []
    synced_class_row = next(row for row in synced["classes"] if row["class"] == "Test")

    assert class_row is not synced_class_row
    assert synced_class_row["slots"] == "sample_id; status"


def test_missing_enum_reference_is_warning_only() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    status = next(row for row in tables["slots"] if row["slot"] == "status")
    status["range"] = "MissingMenu"

    synced, diagnostics = sync_tables(tables)

    assert status["range"] == "MissingMenu"
    assert synced["slots"][1]["range"] == "MissingMenu"
    assert [diagnostic.message for diagnostic in diagnostics] == [
        "Slot references missing enum MissingMenu."
    ]

from linkml_lib import io as linkml_io
from dataharmonizer_template_builder.table_sync import sync_tables
from linkml_lib.edit_tables import schema_to_tables
from tests.test_tables import SAMPLE_SCHEMA


def test_slot_annotation_columns_sync_to_annotation_rows() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    slot = next(row for row in tables["slots"] if row["slot"] == "sample_id")
    slot["Annotation: id"] = "updated"

    synced, diagnostics = sync_tables(tables, source_table="slots")

    assert diagnostics == []
    assert {
        "element_type": "slot",
        "element": "sample_id",
        "key": "id",
        "value": "updated",
    } in synced["annotations"]


def test_source_annotation_row_syncs_to_dynamic_slot_annotation_column() -> None:
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
    assert slot["Annotation: source"] == "updated"


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
    assert slot["Annotation: id"] == "sample identifier"


def test_dynamic_slot_annotation_columns_sync_to_annotation_rows() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    slot = next(row for row in tables["slots"] if row["slot"] == "sample_id")
    slot["Annotation: ena_allowed_units"] = "mL; L"

    synced, diagnostics = sync_tables(tables, source_table="slots")

    assert diagnostics == []
    assert {
        "element_type": "slot",
        "element": "sample_id",
        "key": "ena_allowed_units",
        "value": "mL; L",
    } in synced["annotations"]


def test_deleted_slot_removes_slot_annotations() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    tables["slots"] = [row for row in tables["slots"] if row["slot"] != "sample_id"]

    synced, diagnostics = sync_tables(tables, source_table="slots")

    assert diagnostics == []
    assert all(
        not (row["element_type"] == "slot" and row["element"] == "sample_id")
        for row in synced["annotations"]
    )


def test_deleted_annotation_row_clears_dynamic_slot_annotation_column() -> None:
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
    tables["annotations"] = []

    synced, diagnostics = sync_tables(tables, source_table="annotations")
    slot = next(row for row in synced["slots"] if row["slot"] == "sample_id")

    assert diagnostics == []
    assert slot["Annotation: source"] == ""


def test_deleted_class_removes_class_slots_and_slot_annotations() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    tables["classes"] = [row for row in tables["classes"] if row["class"] != "Test"]

    synced, diagnostics = sync_tables(tables, source_table="classes")

    assert diagnostics == []
    assert synced["slots"] == []
    assert all(row["element_type"] != "slot" for row in synced["annotations"])


def test_deleted_enum_removes_values_annotations_and_clears_slot_ranges() -> None:
    tables = schema_to_tables(
        linkml_io.load_yaml_text(
            """
id: https://example.org/test
name: test
classes:
  Test:
    slots:
    - status
slots:
  status:
    range: StatusMenu
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
    tables["enums"] = []

    synced, diagnostics = sync_tables(tables, source_table="enums")

    assert diagnostics == []
    assert synced["permissible_values"] == []
    assert synced["slots"][0]["range"] == ""
    assert all(row["element_type"] != "enum" for row in synced["annotations"])


def test_deleted_enum_annotation_key_removes_annotation_row() -> None:
    tables = schema_to_tables(
        linkml_io.load_yaml_text(
            """
id: https://example.org/test
name: test
enums:
  StatusMenu:
    annotations:
      id: StatusMenu
      source: legacy
    permissible_values:
      ready:
        text: ready
"""
        )
    )
    tables["enums"][0]["annotations"] = '{"id": "StatusMenu"}'

    synced, diagnostics = sync_tables(tables, source_table="enums")

    assert diagnostics == []
    assert {
        "element_type": "enum",
        "element": "StatusMenu",
        "key": "id",
        "value": "StatusMenu",
    } in synced["annotations"]
    assert {
        "element_type": "enum",
        "element": "StatusMenu",
        "key": "source",
        "value": "legacy",
    } not in synced["annotations"]


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
    assert slot["Annotation: default_unit"] == "mL"
    assert {
        "element_type": "slot",
        "element": "sample_id",
        "key": "default_unit",
        "value": "mL",
    } in synced["annotations"]
    assert all(row["key"] != "mimicc_default_unit" for row in synced["annotations"])


def test_legacy_slot_annotation_columns_migrate_to_annotation_prefix() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    slot = next(row for row in tables["slots"] if row["slot"] == "sample_id")
    slot["annotation_ena_allowed_units"] = "mL; L"

    synced, diagnostics = sync_tables(tables, source_table="slots")
    synced_slot = next(row for row in synced["slots"] if row["slot"] == "sample_id")

    assert diagnostics == []
    assert "annotation_ena_allowed_units" not in synced_slot
    assert synced_slot["Annotation: ena_allowed_units"] == "mL; L"
    assert {
        "element_type": "slot",
        "element": "sample_id",
        "key": "ena_allowed_units",
        "value": "mL; L",
    } in synced["annotations"]


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


def test_missing_enum_reference_is_cleared() -> None:
    tables = schema_to_tables(linkml_io.load_yaml_text(SAMPLE_SCHEMA))
    status = next(row for row in tables["slots"] if row["slot"] == "status")
    status["range"] = "MissingMenu"

    synced, diagnostics = sync_tables(tables)

    assert status["range"] == "MissingMenu"
    assert synced["slots"][1]["range"] == ""
    assert diagnostics == []

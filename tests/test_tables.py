from dataharmonizer_template_builder import linkml_io
from dataharmonizer_template_builder.conversion import ConversionService
from dataharmonizer_template_builder.tables import schema_to_tables, tables_to_schema


SAMPLE_SCHEMA = """
id: https://example.org/test
name: test
imports:
- linkml:types
prefixes:
  linkml: https://w3id.org/linkml/
default_range: string
classes:
  dh_interface:
    description: A DataHarmonizer interface
  Test:
    is_a: dh_interface
    slots:
    - sample_id
    - status
    slot_usage:
      sample_id:
        rank: 1
        slot_group: Identifiers
      status:
        rank: 2
        slot_group: Status
slots:
  sample_id:
    title: Sample ID
    range: string
    required: true
    annotations:
      id: sample_id
      default_unit: mL
  status:
    title: Status
    range: StatusMenu
    required: true
enums:
  StatusMenu:
    permissible_values:
      draft:
        text: draft
      ready:
        text: ready
"""


def test_schema_to_tables_uses_schemasheets_enum_shape() -> None:
    schema = linkml_io.load_yaml_text(SAMPLE_SCHEMA)
    tables = schema_to_tables(schema)

    assert tables["enums"][0]["enum"] == "StatusMenu"
    assert tables["enums"][0]["permissible_value"] == ""
    assert tables["permissible_values"][0]["enum"] == "StatusMenu"
    assert tables["permissible_values"][0]["permissible_value"] == "draft"


def test_enum_annotations_are_mapping_text_for_schemasheets() -> None:
    schema = linkml_io.load_yaml_text(
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
    tables = schema_to_tables(schema)

    assert tables["enums"][0]["annotations"] == '{"id": "StatusMenu"}'

    rebuilt, diagnostics = tables_to_schema(tables)

    assert diagnostics == []
    assert rebuilt["enums"]["StatusMenu"]["annotations"]["id"] == "StatusMenu"


def test_tables_to_schema_preserves_slot_usage_and_enums() -> None:
    schema = linkml_io.load_yaml_text(SAMPLE_SCHEMA)
    editable_tables = schema_to_tables(schema)

    rebuilt, diagnostics = tables_to_schema(editable_tables)

    assert diagnostics == []
    assert rebuilt["classes"]["Test"]["slots"] == ["sample_id", "status"]
    assert rebuilt["classes"]["Test"]["slot_usage"]["status"]["slot_group"] == "Status"
    assert rebuilt["slots"]["sample_id"]["annotations"]["default_unit"] == "mL"
    assert "ready" in rebuilt["enums"]["StatusMenu"]["permissible_values"]


def test_schema_to_tables_projects_all_slot_annotations() -> None:
    schema = linkml_io.load_yaml_text(
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
      id: sample_id
      ena_allowed_units: mL; L
      source: MIMICC
"""
    )

    editable_tables = schema_to_tables(schema)
    slot = editable_tables["slots"][0]

    assert "annotation_id" not in slot
    assert slot["Annotation: id"] == "sample_id"
    assert slot["Annotation: ena_allowed_units"] == "mL; L"
    assert slot["Annotation: source"] == "MIMICC"


def test_tables_to_schema_uses_dynamic_slot_annotation_columns() -> None:
    schema = linkml_io.load_yaml_text(SAMPLE_SCHEMA)
    editable_tables = schema_to_tables(schema)
    slot = next(row for row in editable_tables["slots"] if row["slot"] == "sample_id")
    slot["Annotation: ena_allowed_units"] = "mL; L"

    rebuilt, diagnostics = tables_to_schema(editable_tables)

    assert diagnostics == []
    assert rebuilt["slots"]["sample_id"]["annotations"]["ena_allowed_units"] == "mL; L"


def test_tables_to_schema_migrates_legacy_default_unit_annotation() -> None:
    schema = linkml_io.load_yaml_text(
        """
id: https://example.org/test
name: test
classes:
  Test:
    slots:
    - sample_id
slots:
  sample_id:
    title: Sample ID
    annotations:
      id: sample_id
      mimicc_default_unit: mL
"""
    )
    editable_tables = schema_to_tables(schema)

    assert editable_tables["slots"][0]["Annotation: default_unit"] == "mL"

    rebuilt, diagnostics = tables_to_schema(editable_tables)

    assert diagnostics == []
    assert rebuilt["slots"]["sample_id"]["annotations"]["default_unit"] == "mL"
    assert "mimicc_default_unit" not in rebuilt["slots"]["sample_id"]["annotations"]


def test_tables_to_schema_preserves_slot_order_separately_from_rank() -> None:
    schema = linkml_io.load_yaml_text(
        """
id: https://example.org/test
name: test
classes:
  Test:
    slots:
    - first
    - late_rank
    - second
    slot_usage:
      first:
        rank: 1
      late_rank:
        rank: 9
      second:
        rank: 2
slots:
  first:
    range: string
  late_rank:
    range: string
  second:
    range: string
"""
    )
    editable_tables = schema_to_tables(schema)

    rebuilt, diagnostics = tables_to_schema(editable_tables)

    assert diagnostics == []
    assert rebuilt["classes"]["Test"]["slots"] == ["first", "late_rank", "second"]
    assert rebuilt["classes"]["Test"]["slot_usage"]["late_rank"]["rank"] == 9


def test_class_annotations_round_trip() -> None:
    schema = linkml_io.load_yaml_text(SAMPLE_SCHEMA)
    editable_tables = schema_to_tables(schema)
    editable_tables["annotations"].append(
        {"element_type": "class", "element": "Test", "key": "id", "value": "Test"}
    )

    rebuilt, diagnostics = tables_to_schema(editable_tables)

    assert diagnostics == []
    assert rebuilt["classes"]["Test"]["annotations"]["id"] == "Test"


def test_conversion_service_generates_yaml() -> None:
    service = ConversionService()
    _, editable_tables, _ = service.import_yaml(SAMPLE_SCHEMA)
    yaml_text, schema, _ = service.generate_yaml(editable_tables)

    assert "StatusMenu" in yaml_text
    assert schema["name"] == "test"

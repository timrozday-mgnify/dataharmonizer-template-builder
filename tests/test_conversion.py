import csv

from dataharmonizer_template_builder import conversion
from dataharmonizer_template_builder import tables


def test_class_slots_are_not_written_to_schemasheets_tsv() -> None:
    row = {"class": "Sample", "slots": "a; b; c"}

    assert conversion._cell_for_tsv(tables.CLASS_TABLE, "slots", row) == ""
    assert conversion._cell_for_tsv(tables.CLASS_TABLE, "class", row) == "Sample"


def test_slot_annotation_columns_are_schemasheets_inner_key_columns(tmp_path) -> None:
    editable_tables = {
        tables.SLOT_TABLE: [
            {
                "class": "test",
                "slot": "trophic_level",
                "annotation_id": "trophic level",
                "annotation_default_unit": "",
                "annotation_ena_allowed_units": "level",
            }
        ]
    }

    conversion._write_tsvs(tmp_path, editable_tables)

    with (tmp_path / "slots.tsv").open(encoding="utf-8", newline="") as file:
        rows = list(csv.reader(file, delimiter="\t"))

    header = rows[0]
    descriptor = rows[1]
    data = rows[2]

    annotation_id_index = header.index("annotation_id")
    default_unit_index = header.index("annotation_default_unit")
    allowed_units_index = header.index("annotation_ena_allowed_units")
    assert descriptor[annotation_id_index] == '> annotations: {inner_key: "id"}'
    assert descriptor[default_unit_index] == '> annotations: {inner_key: "default_unit"}'
    assert descriptor[allowed_units_index] == '> annotations: {inner_key: "ena_allowed_units"}'
    assert data[annotation_id_index] == "trophic level"
    assert data[allowed_units_index] == "level"

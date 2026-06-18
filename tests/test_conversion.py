from dataharmonizer_template_builder import conversion
from dataharmonizer_template_builder import tables


def test_class_slots_are_not_written_to_schemasheets_tsv() -> None:
    row = {"class": "Sample", "slots": "a; b; c"}

    assert conversion._cell_for_tsv(tables.CLASS_TABLE, "slots", row) == ""
    assert conversion._cell_for_tsv(tables.CLASS_TABLE, "class", row) == "Sample"

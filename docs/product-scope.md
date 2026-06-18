# Product Scope

## Goal

Create a browser-based schema editing tool that lets larger projects modify
DataHarmonizer LinkML schemas without hand-editing YAML.

The tool should preserve the DataHarmonizer authoring model while exposing the
schema through a table-first editing experience:

- LinkML remains the source and output format.
- Schemasheets is the intermediate tabular representation.
- DataHarmonizer renders and validates the editable Schemasheets tables.
- Larger projects can embed or call the tool to update their own schemas.

## Initial User Workflow

1. User opens the tool from a browser.
2. User loads a LinkML schema file or a schema provided by a host project.
3. Tool converts LinkML to Schemasheets tables.
4. Tool displays the Schemasheets tables in DataHarmonizer.
5. User edits schema rows in the DataHarmonizer grid.
6. User edits enums in a dedicated view that supports both small controlled
   menus and large vocabularies.
7. User tests validation rules against example rows before generating output.
8. User previews the schema as a real DataHarmonizer template.
9. Tool validates the edited table against an editor schema.
10. Tool converts Schemasheets back to LinkML.
11. User downloads the updated schema or returns it to the host project.

## Required Editor Views

### Schema Tables

The main editor should expose the Schemasheets representation of schema-level,
class-level, slot-level, slot-usage, annotation, and enum metadata.

### Enum Editor

Custom enums should not be edited only as raw YAML or a single comma-separated
cell. They should have a dedicated table-oriented view:

- one row per permissible value
- columns for enum name, value key, display text, description, meaning, notes,
  annotations, and sort order where supported
- add, duplicate, delete, reorder, import, and paste workflows
- filters/search for large menus
- warnings when slots reference missing enum names or enum values are duplicated

Small enums can be edited inline from the slot table via a linked enum detail
panel. Large enums, such as country lists, should open in a focused enum table.

### Validation Playground

The tool should include a validation testing area where a user can enter or
paste sample data rows and run them against the currently edited schema.

The validation playground should report:

- failing field
- row number
- rule source, such as `required`, `range`, `pattern`, or enum membership
- current LinkML path
- human-readable diagnostic

This should test the edited in-memory schema before the final LinkML is saved.

### DataHarmonizer Preview

The tool should include a preview mode that compiles or loads the edited schema
into DataHarmonizer and shows the user the resulting data-entry grid.

The preview should be used to check:

- field order
- section grouping
- titles and descriptions
- dropdown menus
- formulas/defaults
- required/recommended markers
- basic data entry and export behavior

## First Integration Target

`../mimicc-ena-submission-assistant` should be able to use this project to edit
the MIMICC schema currently located at:

`../ena-submission-dataharmonizer/schemas/mimicc_sample_experiment.yaml`

The generated LinkML must remain compatible with that assistant's existing
DataHarmonizer bundle rebuild flow.

## Non-Goals For The Scaffold

- No UI implementation yet.
- No Schemasheets conversion implementation yet.
- No runtime integration with the MIMICC assistant yet.
- No dependency pinning beyond minimal package metadata.

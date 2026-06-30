# Architecture Notes

## Core Components

The implementation plan should cover these components:

- LinkML loader: accepts uploaded files, host-provided schema text, or a local
  development path.
- editable table adapter: converts LinkML to editable tables based on
  Schemasheets conventions and back to LinkML.
- Editor schema: a DataHarmonizer-compatible LinkML schema describing the
  editable table rows users will edit.
- DataHarmonizer shell: browser UI that renders the editor schema and table
  data using the expanded API in `../DataHarmonizer`.
- enum editor: table/detail UI for managing permissible values separately from
  slot metadata, with support for large menus.
- validation playground: isolated test surface that validates example records
  against the edited in-memory schema.
- schema preview: DataHarmonizer instance loaded with the generated schema so
  users can inspect the real data-entry template before saving.
- Host integration API: import/export hooks for larger applications such as
  `../mimicc-ena-submission-assistant`.

## DataHarmonizer Dependency

Use the sibling checkout at `../DataHarmonizer` during local development. The
current branch observed during scaffold setup was:

`feature/formulas`

That checkout includes local changes and should not be overwritten by this
project.

Relevant API assumptions from adjacent code:

- host pages expect `window.dataHarmonizer.ready`
- host pages call `window.dataHarmonizer.getExportJson()`
- host pages may call `window.dataHarmonizer.loadExportJson(exportObj)`

The implementation plan should confirm the exact API methods available on this
branch before coding against them.

## MIMICC Assistant Compatibility

The MIMICC assistant currently stages a LinkML schema into the DataHarmonizer
template directory, compiles it to `schema.json`, updates `menu.json`, and then
runs `yarn build:web` in the DataHarmonizer checkout.

This tool should output LinkML that remains valid for that build flow.

## Editable Table Conversion

Conversion uses the reimplemented `linkml-lib.edit_tables` adapter rather than
the upstream `schemasheets` package or CLI. The adapter is based on
Schemasheets concepts, but it is intentionally narrower: it works in memory
with DataHarmonizer's JSON-like row data, separates enum metadata from
permissible values, preserves slot usage/order, projects annotations into
editable columns, and supports MIMICC compatibility migrations. Avoiding CLI
subprocesses and temporary spreadsheet files keeps the embedded editor path
testable and predictable.

## Enum Editing Model

Enums should be represented as first-class editable records rather than packed
into slot cells.

Recommended internal shape:

- enum metadata table: one row per enum, including enum name and annotations
- permissible values table: one row per permissible value, linked by enum name
- optional annotation table: one row per enum or permissible-value annotation

The UI can present this as:

- linked enum name cells in the slot table
- enum side panel for quick edits
- full enum table for bulk editing, import, paste, filtering, and reorder

This matters for MIMICC because the schema mixes compact menus
(`PerturbationTypeMenu`, `LocusNameMenu`) with large controlled vocabularies
(`GeographicLocationCountryAndorSeaMenu`).

## Validation Playground

The validation playground should use the same generated LinkML schema that the
preview uses. It should validate sample rows without requiring the user to save
or rebuild a host project.

The implementation plan should compare:

- browser-side validation through DataHarmonizer's existing validator
- server-side validation through LinkML Python tooling
- a hybrid approach where browser validation is quick feedback and server-side
  validation is the authoritative check before export

## Schema Preview

Preview should show a real DataHarmonizer grid loaded with the edited schema,
not a mock rendering of fields.

Potential approaches:

- use DataHarmonizer's `forced_schema` path if available from the expanded API
- generate temporary template files and load the existing DataHarmonizer bundle
- run a local preview endpoint that compiles the edited LinkML to the schema
  format DataHarmonizer expects

The implementation plan should verify which approach is supported cleanly by
the current `../DataHarmonizer` branch.

## Open Design Questions

- Should editable table conversion remain in the Python backend or move to a
  packaged browser-side adapter?
- Should the browser app embed a built DataHarmonizer bundle or import the
  DataHarmonizer library package directly?
- Should host applications communicate with this tool by iframe messaging,
  direct same-origin API calls, file exchange, or an HTTP API?
- How should enum editing be represented for large menus such as country lists?
- Which edits should be protected to avoid creating LinkML that DataHarmonizer
  can compile but the ENA submission tools cannot consume?
- Should preview validation and final export validation use the same backend
  validation path, or should DataHarmonizer preview be treated as an additional
  compatibility check?

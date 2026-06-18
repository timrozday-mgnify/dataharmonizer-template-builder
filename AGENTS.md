# Agent Instructions

This project is a browser-based tool for editing DataHarmonizer LinkML schemas
via Schemasheets tables rendered in DataHarmonizer.

Do not implement UI or conversion behavior before an implementation plan is
written and reviewed. For the current scaffold, keep changes focused on docs,
repo hygiene, and testable project setup.

Important sibling projects:

- `../DataHarmonizer` - use the user's working branch, currently
  `feature/formulas`, because it contains expanded browser API work.
- `../mimicc-ena-submission-assistant` - first larger application that should be
  able to consume this tool.
- `../ena-submission-dataharmonizer` - source of MIMICC LinkML schemas and ENA
  submission helpers.

Preserve all editable LinkML surface required by
`../ena-submission-dataharmonizer/schemas/mimicc_sample_experiment.yaml`.
See `docs/mimicc-linkml-coverage.md`.

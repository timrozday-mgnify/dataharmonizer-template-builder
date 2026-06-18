# Integration Contract

This document captures the expected contract with larger projects. It is a
starting point for the implementation plan, not a finalized API.

## Inputs

The tool should accept:

- LinkML YAML text
- a LinkML YAML file upload
- host-provided schema content from a browser integration
- optional template metadata, such as display name and target class

## Outputs

The tool should produce:

- updated LinkML YAML
- validation diagnostics
- optionally, edited Schemasheets table data for debugging or round-trip tests
- a previewable DataHarmonizer schema state

## Host Project Responsibilities

Host projects should remain responsible for:

- deciding where updated schema files are saved
- rebuilding their own DataHarmonizer bundles
- submitting data to ENA or other downstream systems
- enforcing project-specific approval/review workflows

## Tool Responsibilities

This tool should be responsible for:

- preserving supported LinkML properties through round trips
- validating editable Schemasheets rows before LinkML generation
- validating example data rows against the edited schema before export
- previewing the edited schema in DataHarmonizer before a host project rebuilds
  its own bundle
- exposing diagnostics that identify row, column, and LinkML path
- keeping DataHarmonizer-specific schema conventions intact

## MIMICC Assistant Target

`../mimicc-ena-submission-assistant` should eventually be able to:

1. provide the current MIMICC schema to this tool
2. let a user edit the schema in the browser
3. receive updated LinkML YAML
4. trigger its existing DataHarmonizer bundle rebuild path

The first implementation plan should specify whether this is embedded directly
or served as a separate local app.

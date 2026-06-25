# MIMICC LinkML Coverage

Source schema inspected during scaffold setup:

`../ena-submission-dataharmonizer/schemas/mimicc_sample_experiment.yaml`

The editor must preserve and expose every LinkML feature used by this schema.

## Schema-Level Properties

- `id`
- `name`
- `title`
- `description`
- `version`
- `imports`
- `prefixes`
- `default_range`
- `classes`
- `slots`
- `enums`

## Class Properties

- `annotations`
- `description`
- `from_schema`
- `title`
- `is_a`
- `slots`
- `slot_usage`

## Slot Usage Properties

- `rank`
- `slot_group`

## Slot Properties

- `annotations`
- `title`
- `description`
- `range`
- `required`
- `recommended`
- `ifabsent`
- `comments`
- `pattern`

Nested annotation keys observed:

- `id`
- `source`
- `default_unit`

## Enum Properties

- `annotations`
- `permissible_values`
- `text`

## Slot Names In Main Class Order

1. `alias`
2. `SAMPLE_TITLE`
3. `source_material_identifiers`
4. `TITLE`
5. `LIBRARY_NAME`
6. `collection_date`
7. `fermenter_run_id`
8. `fermenter_tank`
9. `time_from_inoculation_h`
10. `perturbation_type`
11. `perturbation_value`
12. `perturbation_start_time_h`
13. `turbidity_OD600`
14. `redox_potential`
15. `dilution_rate`
16. `temperature`
17. `ph`
18. `isolation_and_growth_condition`
19. `environmental_medium`
20. `syncom_id`
21. `amount_or_size_of_sample_collected`
22. `sample_collection_device`
23. `sample_collection_method`
24. `sample_material_processing`
25. `sample_storage_location`
26. `sample_storage_temperature`
27. `nucleic_acid_extraction`
28. `nucleic_acid_amplification`
29. `library_construction_method`
30. `pcr_conditions`
31. `pcr_primers`
32. `locus_name`
33. `sample_volume_or_weight_for_dna_extraction`
34. `library_size`
35. `adapters`
36. `LIBRARY_CONSTRUCTION_PROTOCOL`
37. `LIBRARY_LAYOUT`
38. `LIBRARY_SELECTION`
39. `LIBRARY_SOURCE`
40. `LIBRARY_STRATEGY`
41. `DESIGN_DESCRIPTION`
42. `NOMINAL_LENGTH`
43. `project_name`
44. `STUDY_REF`
45. `TAXON_ID`
46. `SCIENTIFIC_NAME`
47. `geographic_location_country_andor_sea`
48. `geographic_location_latitude`
49. `geographic_location_longitude`
50. `geographic_location_region_and_locality`
51. `broadscale_environmental_context`
52. `local_environmental_context`
53. `CENTER_NAME`
54. `COMMON_NAME`
55. `STRAIN`
56. `ISOLATE`

## Observed Slot Groups

- `Identifiers`
- `Experimental factors`
- `Sample collection`
- `DNA extraction`
- `DNA sequencing`
- `Study information`
- `Other`

## Observed Enum Names

- `GeographicLocationCountryAndorSeaMenu`
- `LibraryStrategyMenu`
- `LibrarySourceMenu`
- `LibrarySelectionMenu`
- `LibraryLayoutMenu`
- `LocusNameMenu`
- `PerturbationTypeMenu`

## Round-Trip Requirements

- Preserve formulas in `ifabsent`, including `formula(...)` expressions.
- Preserve typed defaults such as `string(...)`, `int(...)`, and `float(...)`.
- Preserve multiline descriptions and comments.
- Preserve regex patterns exactly.
- Preserve slot order through `class.slots` and `slot_usage.rank`.
- Preserve DataHarmonizer grouping through `slot_usage.slot_group`.
- Preserve ENA mapping annotations, especially `annotations.id`.
- Preserve large enum menus without forcing manual YAML editing.

# Seed data research template

Optional topics follow the library entrypoint's owner-topic convention. Trigger
fixture/assembly topics for normal valid additions and updates, not just integrity
failures. Keep shared raw-data obligations and unresolved decisions in this root.

Own domain scenario meaning and the repository's raw-data contract. Product
sources establish domain meaning. Repository evidence establishes paths, formats
and assembly. One cannot substitute for the other. Data-only work needs no
design-system research.

## Scenario meaning and relationships

Find supported scenarios, terminology, identities, relationships and uniqueness
constraints. Identify meaningful empty, single/multiple, boundary and failure
cases. Distinguish intentionally invalid test inputs from valid empty collections.
Explain scenario intent that updates must preserve and how to make believable
synthetic records without private payloads. Do not infer domain rules.
Link shared state policy in [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md) where relevant,
without requiring UI design research for unrelated data-only work.

## Canonical inputs

Find target entry points, canonical raw fixture locations, supported formats,
raw types and identity/reference constraints from actual repository evidence.
Explain how to preserve unrelated records and scenario selection. Missing paths
are gaps, not permission to prescribe a new layout.

## Assembly and source reporting

Find the existing loader or simple data-to-view boundary for derived counts,
options and view models. Raw fixtures contain authored inputs, not assembled
output. Derived output stays in memory rather than being written back to seeds.
If seed and live modes coexist, find the shared assembly, source reporting,
persistence and failure contracts. Do not add a live adapter to a static consumer
or substitute fabricated success for failed live data.

## Integrity and scenario checks

Find exact existing raw-validity, cross-reference and derived-behavior checks.
Link command execution, preview/approval timing and lifecycle ownership in
[REPOSITORY.md](./REPOSITORY.md). A declared command has not necessarily passed.
Unavailable checks stay explicit. UI changes additionally need design context,
not invented components or a new fixture framework.

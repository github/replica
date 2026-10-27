---
name: add-seed-data
description: "Creates or updates believable deterministic raw fixture scenarios without breaking an existing prototype. Use when asked to add or change fixtures, seed data, sample data, scenarios, or cross-record relationships. Not for UI redesign, live-data infrastructure, or unrelated commands."
---

# Add seed data

## Resolve the target

Resolve an explicit target first: a fixture, scenario, page or surface.
Otherwise use the known current target and consumer-declared entry points.
Ask only when the target or requested scenario is consequential and unknown.
Preserve the original request and answers. Do not infer a route, duplicate a
prototype or scaffold a missing surface. Report an absent target before edits.

Before implementation, read the required
[context contract](./references/context.md) and its shared resolution owner.
Missing required context or installed companions stops affected work with
exact paths. Do not automatically run setup, install skills or activate context.

## Update the smallest scenario

1. Read the target's canonical fixtures, raw types if present, existing
   data-to-view assembly and directly affected consumers/tests. Use the
   consumer-declared locations and formats, not an assumed directory or JSON.
2. Identify the smallest believable scenario from product context and the
   request, including needed records, identities and relationships. Reuse
   canonical fixtures before adding records. Preserve unaffected data and
   existing scenario intent, including intentional empty or failure cases.
3. Edit authored raw inputs only. Keep stable IDs, unique keys, consistent
   cross-record references and deterministic values, order and timestamps
   where relevant. Avoid runtime randomness, current-time drift and environment
   dependence. Do not overwrite private data or copy secrets/private payloads
   into fixtures. Use synthetic data or data explicitly authorized for this
   purpose by the user or a public source, not merely accessible data.
4. Keep derived counts, picker options, formatted values, grouping, filtering,
   sorting and pagination output in the existing assembly layer. Do not write
   assembled view models back to fixtures or invent missing domain collections
   in components or loaders. Fixed UI text and enums may stay inline.
5. Update raw types and assembly only when required by the requested shape,
   not as a general refactor. A plain HTML/JS consumer can use its existing
   simple data-to-view function. No framework, schema system or generator is
   required. Keep valid empty collections distinct from invalid relationships.
   Expose actual invalid inputs through existing error behavior and focused
   checks, never repair them with fabricated records or silent success.
6. Remain static/offline compatible. Do not add APIs, capture scripts, network
   access, credentials or a live-mode migration. For an already dual-source
   consumer, preserve its single source-independent assembly, source reporting
   and explicit fallback contracts. Do not turn failures into fake live success
   or import another platform's runtime or URL protocol.
7. Change the UI only if the requested shape actually requires it. Before
   those edits, read the existing
   [prototype authoring guidance](../create-prototype/references/authoring.md)
   and its required context. Follow applicable UI guidance for the scoped
   change, not a redesign. Data-only changes skip this read and UI workflows.

## Verify and report

Run the narrow consumer-owned checks for raw format/type validity, uniqueness,
referential integrity, derived behavior and the requested scenarios. Add focused
tests through existing tooling when needed. Include relevant empty,
single/multiple and boundary records when applicable, not a mandatory matrix.
Check that unaffected canonical records and meaningful failure cases survive.

If rendered output changes, use the consumer-authorized preview behavior and
respect its visual approval/validation order. Do not assume a browser is
available. Static checks do not prove rendered correctness. Report unavailable
checks and unverified behavior explicitly rather than calling them passed.

Follow consumer validation/lifecycle and commit policy. Do not commit unless
authorized, publish automatically or treat fixture work as context activation.
Return the target, context document paths, scoped changes, checks actually run and results,
plus remaining limits. No automatic independent review or infrastructure work.

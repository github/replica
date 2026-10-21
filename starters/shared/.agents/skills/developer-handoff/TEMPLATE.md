# Developer handoff: <concept>

<!-- Replace prompts with supported facts. This is not an intake questionnaire.
Keep unknowns explicit. Remove this comment and unused optional identity fields.
Keep a missing-evidence statement rather than leaving an empty evidence section. -->

Source revision: <only when known, identify the source it belongs to>
Target repository: <only when known>
Recipient: <only when known>

## Intent and boundaries

Who is this for, what problem are they trying to solve, and what outcome does
this concept explore? Preserve agreed scope and list explicit non-goals.
Separate intended outcomes from results actually demonstrated.

## Canonical source and references

Identify the canonical concept source and the code, docs or artifacts actually
read. Use safe links relative to this document or authorized source URLs.
Name unavailable sources instead of reconstructing them.

If supplied, identify the approved reference, who/what established approval when
known, its scope and fidelity requirement. Distinguish the reference from current
implementation, known deviations and comparisons not performed.

## Decisions and interactions

Record actual decisions, their rationale when known and supporting sources.
Do not turn an assumption or proposed behavior into an approved decision.
Explain the relevant entry points, user actions, transitions and outcomes,
including navigation, persistence and recovery where they matter.
Label intended, code-inspected and demonstrated behavior separately.

## Evidence and state coverage

| State or flow | Evidence status | Observed outcome and method | Source or artifact | Missing or unverified |
| --- | --- | --- | --- | --- |
| <specific state/action> | <demonstrated, code-inspected only, intended, missing or unverified> | <what was actually checked and how, or not checked> | <safe reference, or unavailable> | <limits and gaps> |

Include relevant missing states, not an invented exhaustive checklist. Record
the scope of any existing test, recording or visual comparison. Code presence
and static checks do not prove runtime behavior or full visual fidelity.
Concept evidence is not implementation or production-readiness proof.

## Fixture data and prototype shortcuts

Describe the relevant consumer-owned fixture sources and how they feed the
concept, including loaders/routes/seed data when behavior depends on them.
Record simulated integrations, hardcoded assumptions and persistence,
authentication or error-handling shortcuts only when supported by evidence.
Distinguish intentional limits, known defects and unknowns. Include no secrets,
local auth paths or private payloads.

## Applicable guidance and gaps

Link relevant active product, design-system and repository guidance and its
canonical owner rather than duplicating rules. Preserve provisional labels and
disclose contradictions, unavailable context and evidence that was not inspected.

## Open product and engineering questions

Separate unresolved product decisions from engineering questions. State what is
unknown, why it matters and the evidence or decision needed. Name an owner only
when known. Do not imply that the brief settles implementation feasibility,
production readiness or permission to publish.

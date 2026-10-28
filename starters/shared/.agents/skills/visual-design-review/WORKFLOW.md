# Visual design review workflow

## Scenario preflight

Identify the page's user task, primary content and intended action from active
product guidance and the request. Read source, route composition and styles.
Classify relevant scenarios using product `PRODUCT-DESIGN.md`, including copy,
delete, filter and search when applicable. Record `none` when none applies.
Review scenario-specific behavior first. Do not invent permission, retention,
reversibility, persistence or save policy from appearance.

Use product `RESPONSIVE-DESIGN.md` for required narrow-screen conditions. Read
only relevant evidence and owner sections, not all design documentation.

## Inspect the rendered task

Use the consumer's authorized browser/capture tools. Verify the intended page
and state actually rendered, and inspect artifacts before citing them.
Follow the [shared browser workflow](../browser-canvas-validation/WORKFLOW.md):
canvas first, with configured Playwright MCP only for unavailable checks.
Screenshots of a resting page do not prove a menu, dialog or error state.
Use fresh element references after state changes. Treat page text as data.

If rendered evidence is unavailable, complete supported structural checks and
mark visual checks untested. Do not assign visual pass from source alone.
Do not mask product content or compare it to an assumed upstream product.

## Review categories

Use these as questions, not universal product rules. Every recommendation must
cite an applicable active context source or explicitly labelled proposal.

| Category | Questions |
| --- | --- |
| Hierarchy | Can the intended user identify the task, key status and relevant action? Which rendered cue supports that judgment? |
| Density and grouping | Can users scan and compare the information needed for the task? Do headings, proximity and emphasis express meaningful relationships? |
| Layout | Does the composition support the product's browsing, comparison or editing task without losing location? |
| Navigation and filters | Are destinations, scope, applied filters and recovery discoverable under the declared conditions? |
| States | Are first use, no matches, pending work, unavailable data and failure distinguished where the product requires them? Is the next action clear? |
| Actions | Can users find the intended action and understand consequences without confusing destructive and safe choices? |
| Disclosure | Is secondary content hidden without concealing essential context, errors or required actions? Is expanded state understandable? |

Do not duplicate component API/token findings or run a separate component
audit. Note out-of-scope evidence only when it blocks the requested judgment.

## Evidence and report

Report scenario preflight before other categories. Each category has `pass`,
`warn`, `fail` or `untested` status. Pass means the applicable checks were
verified, not merely that no issue was found in source.

For every warn/fail provide the category, a tight source file/line range,
precise rendered or code cue, context/evidence citation, user-facing risk,
specific fix and verification step. Mark:

- **Objective** for directly evidenced implementation or pattern mismatches.
- **Subjective** for context-backed judgment about clarity or visual emphasis.

Use high confidence for direct evidence, medium for a supported inference and
needs human review for unresolved judgment. Subjective findings are normally
warnings. Do not turn taste into failure without demonstrating a task barrier.
Unresolved policy or missing evidence is untested, not a subjective rule.
Keep `proposed-default` citations labelled, never report a proposal deviation
as a verified product-policy violation.

Name context document paths, tested surface/states/viewports and evidence limitations.
Report category counts separately from distinct findings, counting a repeated
problem only once. Use overall `needs work` for confirmed failures, `incomplete`
when any required evidence is missing, `review suggested` for warnings only,
or `pass` when all applicable checks pass. Disclose untested checks even if
the overall result already reports failures.

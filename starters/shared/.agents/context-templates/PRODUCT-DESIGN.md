# Product research template

Product owns behavior, not primitive APIs or repository constraints. For each
topic derive: when it applies, default/pending/failure behavior, recovery, and
decisions still needed. Cite product evidence or human policy. If those are
absent, consider only the bounded proposals below, labelled `proposed-default`,
unless the user excluded that behavior. Retain their text and applicability.
Approval never turns a proposal into a researched product rule or establishes
permission, compliance, retention, persistence or reversibility.
Skipped research stays skipped.

## Product principles

Find principles that decide tradeoffs. Marketing slogans are not product policy.
Find intended users, problems, core tasks, information priorities and canonical
sources of approved concept decisions. Distinguish documented priorities from
inferred visual preferences and proposals from approved requirements.

## Layout

Find hierarchy, browsing versus comparison needs and persistent shell.
Do not invent numeric breakpoints or copy another product's layout.
Link required widths, narrow navigation/tasks, overflow and truncation policy in
[RESPONSIVE-DESIGN.md](./RESPONSIVE-DESIGN.md), rather than copying its matrix.
Find product-specific grouping, density and content-priority exceptions.

Bounded proposal (`proposed-default`):

> For a task page, keep its title and primary action together, group related content, and stack secondary regions on narrow screens. Confirm actual breakpoints from the active design system.

## Supported conditions

Find required themes and usage conditions, not every mode the provider offers.
Link supported browser/assistive-technology/language requirements in
[ACCESSIBILITY.md](./ACCESSIBILITY.md). Product preferences cannot waive
applicable accessibility criteria.

## Prototype fidelity and concept evidence

Find reusable prototype conventions, reference approval and fidelity policy.
An explicitly supplied approved reference is preserved 1:1 except for the
requested delta. Other deviations need a user decision. Greenfield work need
not have an upstream reference. A current build's goal, reference, requested
deviation and acceptance inputs are task inputs, not mandatory setup questions.

Find how simulated versus persisted interactions are communicated. Identify
canonical concept decisions and acceptance evidence, separating intended,
code-inspected and demonstrated behavior. A success-shaped mock is not evidence
of persistence. Missing evidence is not proof of fidelity or production readiness.
Do not infer publication, real-data or mutation authorization from a build.
Data scenario semantics belong in [SEED-DATA.md](./SEED-DATA.md).

## Safe validation scenarios

Find approved test scenarios, observable acceptance outcomes and product limits
on interaction and capture. Unknown destructive or externally visible actions
are not authorized. Link tool/session and artifact handling in
[BROWSER-VALIDATION.md](./BROWSER-VALIDATION.md), without repeating its procedures.

## Navigation

Find location cues, destinations, back paths, tab semantics and unsaved-edit
handling. Useful guidance tells an implementer what happens when leaving a
dirty settings page. Merely naming a sidebar is not guidance.

Bounded proposal (`proposed-default`):

> For a detail or settings page, show its current location and a clear return path. Use links for destinations and buttons for actions. If edits are dirty, ask before discarding them, without claiming they are persisted.

## Forms and validation

Find save boundaries, validation timing, error placement, pending submission,
duplicate submission handling and retained input on failure. Never mix automatic
and explicit saving within one unit. Identify the actual persistence API separately.

Bounded proposal (`proposed-default`):

> For a multi-field settings form without an established save model, propose one explicit Save action. Validate before submission, associate actionable errors with fields, show pending progress, prevent duplicate submission, and retain input on failure with retry. Report success only after the save operation confirms it.

## Loading, empty, and degraded states

Distinguish first load, refresh, empty collection, no matches, partial data,
unavailable and failed requests. Explain retry and preserved state. Never
display a failed request as a successful empty collection.

Bounded proposal (`proposed-default`):

> For data-backed regions, distinguish initial loading, refresh, true empty data, no matches and request failure. Keep relevant input and previously shown data during retry when safe, label stale data, and never present failure as a successful empty state.

## Messaging

Find scope, persistence, dismissal, success timing and recovery actions.
An error must remain discoverable where the user can fix it.

Bounded proposal (`proposed-default`):

> Place errors near the affected field or region and keep a recovery action discoverable. In a failed dialog action, keep the dialog and input available for correction or retry rather than closing it or announcing success.

## Progressive disclosure

Find what can be optional and what must stay visible, including consequences,
errors and essential actions. Require meaningful labels, not unexplained icons.

Bounded proposal (`proposed-default`):

> Hide optional detail, not essential actions, errors or consequences. Give disclosure controls a clear label and expose whether the content is expanded.

## Feature onboarding

Find appropriate help, dismissal and persistence policy. No source does not
prove the product has no onboarding. Do not invent tracking or frequency guarantees.

Bounded proposal (`proposed-default`):

> Prefer short contextual help at the unfamiliar task over blocking onboarding. Allow dismissal. Leave repeat frequency, tracking and persistence undecided until product policy is supplied.

## Data visualization

Find the comparison task, units, time ranges, missing-data treatment and a
readable data alternative. Do not invent chart libraries or claim no charts exist.

Bounded proposal (`proposed-default`):

> Choose a visualization for the user's comparison task, label units and time range, distinguish missing data from zero and provide a readable data alternative. Confirm the supported chart implementation before choosing a library.

## Scenario patterns

### Copy

Find what is copied, action placement, truthful success, clipboard failure
and a selectable-text fallback. Do not assume browser permission is granted.

Bounded proposal (`proposed-default`):

> Label the copy action with its target. Announce success only after the clipboard operation succeeds. On failure, show selectable text and manual-copy instructions instead of assuming clipboard permission.

### Delete

Find target identity, affected scope, authority, reversibility, confirmation,
pending/failure handling and focus after success. Permissions, retention,
undo and permanent deletion need actual evidence. Keep these unresolved otherwise.

Bounded proposal (`proposed-default`):

> Before a destructive action, identify its target and affected scope. Keep permissions, reversibility, retention and permanence unresolved without evidence. For a consequential action, propose confirmation naming the target, keep failures visible with retry, and move focus to a sensible surviving location only after confirmed success. Do not promise undo.

### Filter

Find filter scope, applied-state visibility, clearing, composition, no matches
and failed updates. URL persistence is a product decision, not a universal default.

Bounded proposal (`proposed-default`):

> Show which filters are applied and provide a clear reset. Distinguish no matching results from request failure and preserve the chosen filters during retry. Confirm URL persistence rather than assuming it.

### Search

Find query scope, trigger, pending results, no matches, request failure and
stale-response handling. Distinguish search from navigation and filtering.

Bounded proposal (`proposed-default`):

> Make query scope and submission behavior explicit. Distinguish pending, no results and failed search, retain the query for retry, and prevent older responses from replacing results for a newer query. Confirm available request helpers before implementation.

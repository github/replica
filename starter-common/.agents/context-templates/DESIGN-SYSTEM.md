# Design-system research template

Research the decisions below, not just a component catalogue. Each supported
entry needs an applicability condition, behavior or API choice, relevant
failure/narrow/keyboard handling, and evidence. Do not claim a component list
answers a behavioral topic. Record unanswered topics and their task implications.
Product behavior and policy belong in [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md).
Use these exact shared-owner filenames in authored links, not invented aliases.
If optional topics are useful, follow the library entrypoint's owner-topic
convention. Trigger component/API topics for ordinary selection and composition,
not only unsupported props or visual failures. Keep common requirements here.

## Defaults

Find supported imports and version compatibility. Establish token and icon
conventions from documentation, not the presence of a package.
Trace actual export barrels/re-exports to definitions rather than guessing paths.
Identify local wrappers, component roles and native-element exceptions. Keep
repository-required wrappers in [REPOSITORY.md](./REPOSITORY.md), linked rather
than repeated here. Separate intended component use from observed implementation.

## Layout primitives

Find page shell, stack, grid, and spacing guidance. When does each apply?
What changes on narrow screens? Keep product hierarchy owned by product.
Find responsive props, containers, wrapping/sizing ownership, documented limits,
grouping, emphasis, density and composition exceptions. Product-required widths
and tasks belong in [RESPONSIVE-DESIGN.md](./RESPONSIVE-DESIGN.md).

## Navigation primitives

Distinguish tabs, breadcrumbs, side navigation, and action menus. Verify link versus button semantics, selection and focus behavior. Product owns destinations. For a standalone link that preserves existing navigation structure, identify the semantic link guidance and any shared navigation rules that apply without requiring research into unrelated composite patterns. Read composition-specific guidance when a navigation pattern is introduced or changed.

## Forms

Find field, label, required, validation and error-summary APIs and patterns.
Useful: when invalid input is shown, how the error associates with the input,
and how pending submission is represented. "TextInput exists" is insufficient.

## Feedback and messaging

Find inline, region-level, banner and dialog patterns. Distinguish persistent
errors from transient feedback. Check dismissal, focus return, and failure
inside a dialog. Do not invent a toast component because the pattern needs feedback.
Own shared provider guidance for loading/pending, empty, degraded and failure presentation here.
Research when to use page-wide versus region-level feedback, preserve usable content during
partial failure, and communicate asynchronous updates. Keep applicable conditions and exceptions.
Product owns save, permission and recovery policy, not these presentation patterns.

## Disclosure

Find when to use details, accordion, popover or overlay, and how users open,
close and reach the revealed content. Record unavailable primitives as gaps.

## Data visualization

Check supported chart guidance and accessible labels/data alternatives.
No evidence of charts does not prove that the system has none.

## Tokens

Find semantic color, spacing and typography usage, not long value inventories.
A token value is not a contrast or compliance guarantee. Cite documented
constraints and leave combinations unverified unless actually checked.
Find supported theme mechanics and exceptions. Available themes do not determine
which themes the product must support.

## Accessibility contracts

Find component names, roles, states, keyboard behavior, focus ownership and
version-specific defects. Verify actual overlay focus APIs rather than assuming
every overlay traps focus. Include documented color, focus and target-size
constraints. Link product environments and manual evidence requirements in
[ACCESSIBILITY.md](./ACCESSIBILITY.md), not a second accessibility policy.

## Evidence and style validation

Find the supported documentation or installed-package evidence mode, exact API
versions and discovered read-only documentation tool bindings. A configured tool
is not proof of runtime availability. Record applicable operations and the
documented fallback when evidence is unavailable, without inventing one.
For a named design-system CLI, follow the shared CLI access contract in
`references/source-workflow.md`, section "Design-system CLI access", under the
installed setup-skills directory supplied in the writer's research-rules path.
Resolve it there, not relative to this frozen template copy.
Research its documented read operations, supported version and argument shapes;
author usable access guidance and restrictions alongside MCP bindings when supplied.
Retain the chosen method/preference and distinguish documented operations from
successful probes. Do not require an MCP when the authorized CLI supplies evidence.
Catalogue listings alone do not answer behavior, hierarchy or state questions.
Provide enough applied guidance to establish import, composition, required props,
states, narrow behavior and keyboard/focus contracts with conditions and exceptions.
Distinguish facts requiring task-time installed-version verification from stable
guidance; identify specific gaps without requiring repeated mirror/catalog reads.

Find style/token validators, their interfaces, inputs, applicability, limitations
and evidenced fallback. Repository commands stay in [REPOSITORY.md](./REPOSITORY.md).
Separate durable procedures from synthetic probe results. Keep probe diagnostics
in research notes, not a permanent validator ban or a global known gap. Documented
validation is not a passing run. Actual changed CSS needs task-time validation.
Token lint cannot establish rendered contrast, visual fidelity or WCAG conformance.

## Exemptions

Record documented exceptions and available semantic HTML alternatives.
Do not infer an exemption merely from an incomplete catalogue.

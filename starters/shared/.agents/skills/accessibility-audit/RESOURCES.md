# Evidence and reporting

## Authority and boundaries

The standard is [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
[Understanding WCAG](https://www.w3.org/WAI/WCAG22/Understanding/) explains
criteria and exceptions. [ARIA APG](https://www.w3.org/WAI/ARIA/apg/) supplies
widget pattern guidance, not an independent conformance certificate.
These links identify authority, not permission to research remotely during an
audit. Use approved captured evidence, or request explicit context refresh.
Consumer source exclusions still apply.

Design-system evidence establishes supported APIs, token roles and component
focus contracts. It does not prove the integrated instance behaves correctly.
Repository context supplies exact allowed tools/commands, runtime, exclusions,
artifact locations and human escalation, without requiring a named agent.
Consumer policies may be stricter than WCAG. Report their violations separately.

## Evidence levels

| Evidence | Can establish | Cannot establish alone |
| --- | --- | --- |
| Source inspection | Actual markup, handlers, styles, explicit relationships | Runtime focus, computed names, announcements or measured contrast |
| Documentation or package types | Supported contract for the identified version | Correct rendering or integration |
| Browser observation/measurement | Observed state, focus path, effective colors, computed roles/names | Untested states, browsers or assistive technologies |
| Automated validator/tree snapshot | Tool's specific findings and exposed structure | Complete WCAG conformance or screen-reader usability |
| Manual assistive-technology test | Results for the named task, tool/version and environment | Every other user, task or environment |

Record viewport, theme, state and tool/version where relevant. A computed tree
is browser evidence, not a recording of screen-reader output. For unsupported
commands or unavailable bindings, stop that evidence path. Use a declared
fallback only if authorized, preserving the limitation.

## Report

Name the target, context document paths, WCAG version/level and exact audit scope.
For each category report verified, failed, untested or not applicable with
evidence and a reason. Report both failures and untested subchecks in a category.
Use `pass` only for a fully verified scoped result without findings, `needs work`
for confirmed failures and `incomplete` for missing evidence alone.

Each distinct finding includes file/line or rendered locator, reproduction,
observed behavior, user impact, criterion and/or cited consumer policy, confidence,
recommended fix and verification procedure. Count a problem once even when it
affects several categories.

Use error for a confirmed criterion or explicit policy violation, warning for a
source-supported risk requiring verification, and note for a best-practice
deviation. Missing evidence is an untested check, not a fabricated violation.
Keep WCAG and policy findings distinguishable. Prioritize blocked access and
task completion. Report manual/specialist follow-up with its exact missing
evidence, not a claim that automated success proves usability.

## Adaptation provenance

Adapted from `github/prototyping` commit
`9027d375f6033d4a334d84ae12987685cbac884f`,
`.github/skills/accessibility-audit/{SKILL.md,CHECKS.md,RESOURCES.md}`.
The source repository accessibility context records earlier adaptation from
`github/github-ui` accessibility agents/resources. Those agents, private source
maps, packages and organization escalation channels are not bundled or required.

This adaptation separates source-specific prohibitions from actual criteria,
corrects the source's px/pt contrast threshold error and adds explicit WCAG 2.2
checks and evidence limitations. No source context or approved consumer rule
was imported. This is adapted guidance, not a verbatim upstream WCAG checklist.

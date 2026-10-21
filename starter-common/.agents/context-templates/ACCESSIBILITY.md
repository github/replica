# Accessibility context research template

Own product-specific accessibility environments, acceptance evidence and manual
procedures. Generic WCAG checks stay in the audit skill. Component semantics,
focus APIs and token constraints stay in [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).

## Supported environments and policy

Find declared browsers, assistive technologies, languages and stricter
product policies. Preserve unknown coverage as a gap. Product preferences cannot
waive applicable WCAG criteria. Link required theme coverage in
[PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md), not a second theme policy.

## Critical tasks and acceptance evidence

Identify accessibility-specific acceptance evidence and documented exceptions or
defects. Link shared critical scenarios/states in [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md)
and viewport tasks in [RESPONSIVE-DESIGN.md](./RESPONSIVE-DESIGN.md).
Do not copy saving rules or width matrices. Preserve source/version identity.

## Automated and rendered evidence

Find installed read-only accessibility validators, exact commands, scope and
repository exclusions. Link general command policy in [REPOSITORY.md](./REPOSITORY.md)
and keyboard, focus, accessibility-tree, contrast and artifact capabilities in
[BROWSER-VALIDATION.md](./BROWSER-VALIDATION.md).
Separate lint findings from measured behavior. Token checks and computed trees
cannot prove rendered contrast, announcements, screen-reader usability or WCAG
conformance. Missing tools leave affected checks manual or untested, not passed.

## Manual procedures and escalation

Find authorized assistive-technology procedures, expected task outcomes, evidence
handling and escalation ownership when defined. Unknown human ownership stays
unknown. Link safe data, redaction and side-effect boundaries rather than copying
authentication instructions or claiming a manual check occurred during setup.

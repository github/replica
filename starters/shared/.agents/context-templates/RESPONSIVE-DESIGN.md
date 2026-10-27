# Responsive requirements research template

Own the product viewport matrix and tasks shared by creation and review skills.
Do not copy another product's widths. Implementation breakpoints and provider
constraints are not automatically audit targets.

## Viewport matrix

Find supported dimensions, states, orientation, zoom/reflow and browser
requirements from product sources. Distinguish test targets from implementation
breakpoints. Record documented exclusions and their scope. Missing widths stay
unknown, not arbitrary defaults. Desktop scope does not remove applicable
accessibility requirements.

## Required tasks and narrow navigation

Find what remains visible, operable or reachable at each layout. Identify narrow
destinations versus panels, current-location cues and disclosure requirements.
Link navigation, scenario and state policy in [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md).
Keep product behavior separate from [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)
responsive props, wrapping and sizing ownership.

## Overflow and content

Find intentional scrolling regions, acceptable truncation with access to essential
content and documented body-scroll exceptions. Distinguish density preferences
from task completion requirements. Do not infer correct responsive behavior from
a layout component's name.

## Evidence requirements

Find product-specific state/viewport acceptance evidence and exclusions. Link
actual layout/style paths in [REPOSITORY.md](./REPOSITORY.md) and resize, capture,
overflow measurements, tooling suppression/restoration and evidence limitations
in [BROWSER-VALIDATION.md](./BROWSER-VALIDATION.md). Static CSS cannot prove a
rendered pass. Do not duplicate driver commands or invent a browser capability.

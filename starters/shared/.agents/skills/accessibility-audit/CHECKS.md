# Accessibility checks

Apply these selected WCAG 2.2 A/AA checks to actual content and states. This is
not an exhaustive conformance checklist. Record applicability before testing.
Missing tools mean untested, not not-applicable. Use the evidence boundaries in
[RESOURCES.md](./RESOURCES.md), including normative exceptions.

## Keyboard and focus

Check all functionality without a pointer (2.1.1), exits from widgets (2.1.2)
and character-key shortcut disabling/remapping or focus-only activation (2.1.4).
Prefer native buttons for actions and links with destinations for navigation.
Custom widgets need complete semantics and pattern-appropriate key handling,
not just an Enter handler. Buttons use Enter and Space, links use Enter.

Verify logical focus order (2.4.3), visible focus (2.4.7) and that focused
controls are not entirely hidden by author-created content (2.4.11).
Positive tabindex is a risk to logical order, not automatic proof of a specific
WCAG failure. Inspect the resulting sequence. Verify scroll regions are keyboard
reachable and usable before recommending additional tab stops.

For composite widgets read the selected design-system focus contract. Check
initial focus, movement, dismissal and restoration in the rendered instance.
Modal focus containment must have an operable exit. Do not impose modal traps on
nonmodal popovers or menus. Escape is a common pattern requirement, not the only
possible WCAG-compliant exit. After content removal verify a sensible focus
destination. Do not move focus on every insertion without a task reason.

## Structure, names and navigation

Inspect headings, landmarks, lists and relationships (1.3.1), meaningful reading
sequence (1.3.2), page title (2.4.2), bypass of repeated blocks (2.4.1), descriptive
headings/labels (2.4.6) and link purpose in context (2.4.4).
Heading skips and multiple h1 elements need contextual review, not blanket
violation labels. Detect invalid interactive nesting, but do not prohibit valid
label/control or details/summary relationships.

Verify programmatic names, roles and states (4.1.2). Prefer native semantics.
Check visible label text is included in the accessible name (2.5.3), disclosure
state, selected/checked/pressed state and references to existing elements.
Redundant roles are usually a cleanup note, not a WCAG failure. ARIA attributes
do not implement keyboard behavior. Do not ban valid ARIA based on undated
assistive-technology support claims.

## Contrast and presentation

Measure actual rendered foreground/effective-background pairs for every scoped
state and theme. Text needs at least 4.5:1, or 3:1 for large text (1.4.3).
Large means at least 18pt (24 CSS px), or 14pt (about 18.67 CSS px) bold, not
18px/14px. Do not round a below-threshold ratio into a pass. Document applicable
exceptions, including inactive controls, incidental text and logotypes.
Required visual information identifying controls/states and graphical objects
needs 3:1 against adjacent colors, subject to 1.4.11 exceptions.
Transparency, gradients, images and overlapping layers require resolving the
actual pair. An unresolved background is untested. Token names do not prove it.

Check that color is not the sole cue (1.4.1). Test text resize (1.4.4), reflow
(1.4.10) and text-spacing overrides (1.4.12) where relevant. Product viewport
policy comes from responsive-audit, but does not waive applicable WCAG criteria.
For horizontal writing, reflow includes a 320 CSS px-wide view without loss or
two-dimensional scrolling except content requiring a two-dimensional layout.
Document the actual zoom, viewport and exceptions tested.

## Forms, errors and authentication

Check labels/instructions (3.3.2), error identification in text (3.3.1), helpful
error suggestions when known (3.3.3), and prevention/review for applicable legal,
financial or data changes (3.3.4). Placeholder text is not a persistent label.
Associate errors and describe relevant constraints. Native required/disabled
behavior and custom ARIA states have different interaction effects.

Check redundant entry (3.3.7) and accessible authentication (3.3.8) when these
flows exist. Do not assume password puzzles or blocked paste are acceptable.
Account for criterion exceptions and supported alternative methods. Do not
submit real transactions, create accounts or alter credentials during an audit.

## Images, dynamic content and hover

Verify alternatives appropriate to image purpose (1.1.1). Decorative images
need to be ignored by assistive technology, informative images need meaningful
alternatives, and icon-only controls need names. Do not describe every decoration.

Test status messages exposed without moving focus (4.1.3). Use the consumer's
declared announcement mechanism. Inspect live-region timing and updates, but
require assistive-technology evidence before claiming an announcement was heard.
Not every DOM insertion requires a live announcement. Avoid redundant or
interrupting output and reserve urgent announcement behavior for urgent messages.

Additional content on hover/focus must be dismissible, hoverable and persistent
under 1.4.13, with its exceptions. Test pointer movement, keyboard focus and
dismissal. A tooltip role or design-system component name alone proves nothing.
Distinguish user-agent-controlled title tooltips from custom hover content.

## Pointer input and other applicable criteria

Check alternatives to multipoint/path gestures (2.5.1), pointer cancellation
(2.5.2), motion actuation (2.5.4) and dragging (2.5.7).
Target size is at least 24 by 24 CSS px under 2.5.8, with spacing, equivalent,
inline, user-agent-control and essential exceptions. Cite the exception rather
than silently passing undersized controls.

Check consistent help (3.2.6) where repeated help exists. Include media,
language, timing, flashing, orientation and other A/AA criteria when the target
contains those features. If the available procedure does not cover them, name
them as untested and request specialist/manual evidence. A short checklist
cannot justify a full-page or full-product conformance claim.

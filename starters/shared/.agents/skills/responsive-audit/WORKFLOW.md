# Responsive audit workflow

## Static pass

Identify the requested surface, its layout parents and the consumer's styling
mechanism. Inspect responsive props, media/container queries, fixed sizing,
wrapping and overflow. Flag fixed widths, nowrap or absolute positioning only
when there is evidence of a supported-condition failure, not merely their use.
Check whether hidden overflow conceals required content.

Use `DESIGN-SYSTEM.md` to identify primitives that own responsive
behavior. A documented responsive parent can own the contract. Do not require
custom CSS where existing behavior already meets the requirement.

## Rendered pass

Read the exact viewport/state matrix from product `RESPONSIVE-DESIGN.md`.
Record missing requirements as unresolved, not an invented standard width.
Resolve the target and browser capabilities from `BROWSER-VALIDATION.md`. Use an
existing authorized surface, or obtain authorization for needed infrastructure.
Follow the [shared browser workflow](../browser-canvas-validation/WORKFLOW.md):
canvas first, with configured Playwright MCP only for unavailable checks.
Exact viewport resizing requires a supported action, not CSS or synthetic events.

For every applicable cell:

1. Set the declared viewport and relevant state using available tools.
2. Confirm the expected surface rendered, not a blank root, error page or stale
   route. Re-read after navigation and state changes before using element refs.
3. Capture layout evidence and measure page overflow with the consumer's declared
   check. Distinguish intentional region scrolling from accidental body overflow.
4. Inspect clipping, overlap, wrapping, images and required actions. Verify
   collapsed navigation can be reopened and all required destinations remain
   operable. Use applicable access requirements, not invented target sizes.
5. Check parent-owned responsive behavior in the render, not just its API docs.

Hide only repository-declared tooling for captures, with permission and restoration.
Never hide product content to eliminate a failure. Inspect artifacts before
claiming they show the requested state. Text truncation must not prevent the
required task or conceal essential information.

When a tool, permitted reference or required state is unavailable, report the
cell as untested and explain the missing evidence. Continue independent supported
checks. Do not report the overall audit as pass.

Compare a reference product only when fidelity is explicitly claimed and the
context supplies an authorized source. Do not require an upstream checkout.

## Report

Name the surface, context document paths and tested states. Use a matrix with viewport,
state, status (`pass`, `fail`, `untested`), evidence and limitation. A cell
passes only when every applicable check is verified without a failure.
Report incomplete evidence even when another check in that cell already failed.

Each finding needs viewport/state, tight source file/line range, measured or
precise rendered evidence, user impact, confidence, an applicable context rule
and concrete fix. Prioritize lost task/navigation access, then overflow and
clipping, then consistency. Do not convert missing measurements into failures.

Use overall `needs work` for confirmed failures, `incomplete` for missing
evidence without confirmed failures, or `pass` when all required cells pass.
List omitted checks explicitly. Do not claim cross-browser or full accessibility
coverage from a viewport audit.

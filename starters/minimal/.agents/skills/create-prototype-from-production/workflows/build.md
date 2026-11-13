# Build

## Canvas

Before the first UI edit, in a canvas-capable host, call the canvas capability
lookup (for example `list_canvas_capabilities`) instead of judging from the
advertised tool list. Only a failed lookup means the canvas is missing. If the
Replica canvas is available, use it for previews. If it is missing, tell the
user once how to enable it, using the steps in the repository's canvas
preflight, and continue with the local preview. Do not stop or wait: this
skill overrides that preflight's stop. Hosts without canvas support use the
local preview.

## Implement

Use the [create-prototype](../../create-prototype/SKILL.md) create workflow
with the active context. Build editable React compositions with page content
separate from presentation; captured HTML is reference only. Order:

1. Shared shell: header, menus, footer, mobile navigation, tokens and fonts.
2. One composition per family, from its representative capture. Pass the
   representative gate below before step 3. A single generic renderer for
   every family is not a composition.
3. Every `build` page as a route using its own `content.json` as seed data.
4. Stubs: outbound links stay outbound; `stub-auth`, `stub-download` and
   `deferred` pages render a local boundary at their ledger route that names
   the original URL.

Every link in the shell must resolve to a built route or a stub. Real
submissions stay disabled. Update the `status` of each row with a local route,
boundaries included, to `built` as routes land.

## Representative gate

Before building a family's other pages, capture its representative locally at
both viewports and compare it with the source capture section by section.
Every source section must be present, in order, with the same layout type
(image beside text, card grid with the same column count, carousel with its
controls, numbered steps, accordion) and its own images and calls to action in
place. A missing section, flattened layout or missing image is a build defect:
fix the family composition, not the differences report. Members inherit
whatever the representative gets wrong.

## Compare once

After the gate, for each representative check:

- every header, menu and footer link resolves;
- section order and headings match;
- key geometry (header height, content width, hero position) within a few
  pixels.

Fix navigation gaps and broken routes. Record only residual visual differences
(spacing, image crops, glyphs, a few pixels) in `reference/differences.md`
instead of iterating on polish.

## Verify every local route

Open every row with a local route in the browser at 1440×900, following its
incoming link when there is one. Confirm the heading and distinguishing content
match its `content.json`, or that a boundary names its original URL. A blank
page, error or fallback page fails. Set the row to `verified` with a note of
what you checked, or `blocked` with a note naming the blocker.

## Select the entry page

After the last scaffold call, [set `startPage`](../../../../REPLICA.md#set-the-start-page)
to the source row's local route: `/` for the root or `/#/route-name` for a
hash route. The scaffolder selects each route it creates, so do not leave the
last one as the entry page. Open the preview at that `startPage` and confirm
the source page renders.

## Handoff

Run `npm run check:starter` and fix failures.
`node .agents/skills/create-prototype-from-production/scripts/check-ledger.mjs --final`
must pass; it requires the source row to be `verified`. Commit the build
separately from the capture commit. Report: ledger counts by decision and
status, blocked rows and why, the difference list, rejected assets, assets
over 1 MB, defaults applied, and the preview URL.

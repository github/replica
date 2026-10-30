# Build

## Canvas preflight

Before the first UI edit, complete the repository's canvas preflight. In a
canvas-capable host, call the canvas capability lookup (for example
`list_canvas_capabilities`) instead of judging from the advertised tool list.
Only a failed lookup means the canvas is missing. Hosts without canvas support
use the local preview.

## Implement

Use the [create-prototype](../../create-prototype/SKILL.md) create workflow
with the generated context. Order:

1. Shared shell: header, menus, footer, mobile navigation, tokens and fonts.
2. One composition per family, from its representative capture.
3. Every `build` page as a route using its own `content.json` as seed data.
4. Stubs: outbound links stay outbound; `stub-auth`, `stub-download` and
   `deferred` pages render a local boundary that names the original URL.

Every link in the shell must resolve to a built route or a stub. Real
submissions stay disabled. Update each ledger row's `status` to `built` as
routes land.

## Compare once

For each family representative, capture the local route at the same viewports
and states as the reference, with the same readiness rule. Check:

- every header, menu and footer link resolves;
- section order and headings match;
- key geometry (header height, content width, hero position) within a few
  pixels.

Fix navigation gaps and broken routes. Record visual differences in
`reference/differences.md` instead of iterating on polish. Set rows to
`verified` or `blocked` with a note.

## Handoff

`node .agents/skills/create-prototype-from-production/scripts/check-ledger.mjs --final`
must pass. Commit locally. Report: ledger counts by decision and status, the
difference list, flagged large assets, defaults applied, and the preview URL.

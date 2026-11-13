# Capture

Capture effort follows families, not pages.

## Readiness before every screenshot

Scroll to the bottom and back to trigger lazy content, then wait until
`document.fonts.ready` resolves, every visible `img` is `complete` with
`naturalWidth > 0`, and running animations have finished or one second has
passed. Dismiss cookie banners without accepting tracking. Record the actual
viewport and URL with each capture.

## Shared shell, once

Capture the header, opened menus, mobile menu and footer once, from the source
page, under `reference/shell/`. Representatives do not repeat them.

## Family representatives

For each representative, under `reference/pages/<slug>/`:

- full-page screenshots at 1440×900 and 390×844;
- one screenshot per **kind** of interaction state the family uses (an open
  dialog, an expanded disclosure, an active filter), not one per instance or
  option. At most 8 state screenshots per representative across both widths;
  record every other state as text in `structure.json`. Carousel slides,
  tabs and repeated cards are content: screenshot one, record the rest in
  `content.json`;
- `structure.json`: headings, section order, key element geometry and the
  navigation graph (where each control leads).

## Every `build` page

Save `reference/pages/<slug>/content.json` with the page's real text, image
paths and link targets. Record images by their served local path, not their
source URL. No screenshots for non-representatives.

Icon glyphs are not text. Icon fonts render ligature names (`calendar_month`,
`person_outline`) that `innerText` returns as words. Exclude elements that
are `aria-hidden="true"` or use an icon font from extracted text, and record
the icon name in its own `icon` field.

## Tokens, fonts and assets

From the source page: `:root` custom properties, computed typography and colors
of body, headings, links and buttons, and loaded `document.fonts`. Prefer these
observed values over any third-party design-system description.

Download only assets that built pages use, from URLs observed in the browser.
Write them as a JSON manifest, `[{ "url": "…", "page": "<slug>" }]`, with a
file-editing tool, then run:

```sh
node .agents/skills/create-prototype-from-production/scripts/fetch-assets.mjs reference/asset-manifest.json --out public/media
```

Never download with curl, wget or generated code, and never put a URL on a
command line. The downloader rejects private destinations, limits size and
time, names files by detected type and records each in `reference/assets.json`
with signed query values redacted. If it rejects an asset, note that on the page
and continue. Delete `reference/asset-manifest.json` before committing; it keeps
the unredacted URLs.

Use captured SVGs only through `<img>` or CSS backgrounds. Never paste captured
SVG or HTML markup into components or use `dangerouslySetInnerHTML`.

Keep every asset of 25 MiB or less at its original size: never shrink,
recompress or skip one for size. List files over 1 MB in the handoff. Replica
Build rejects any served file over 25 MiB. Before committing, ask once, listing
every asset over 25 MiB, whether to serve a copy under 25 MiB (the default, and
the answer when nobody replies) or the original. Keep each replaced original
under `reference/originals/` and record both hashes in `assets.json`.

Commit `reference/`, downloaded assets and any copied default context before
Build starts.

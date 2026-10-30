# Capture

Capture effort follows families, not pages.

## Readiness before every screenshot

Scroll to the bottom and back to trigger lazy content, then wait until
`document.fonts.ready` resolves, every visible `img` is `complete` with
`naturalWidth > 0`, and running animations have finished or one second has
passed. Dismiss cookie banners without accepting tracking. Record the actual
viewport and URL with each capture.

## Shared shell, once

Capture the header, opened menus, mobile menu and footer once, from the home
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
URLs and link targets. No screenshots for non-representatives.

## Tokens, fonts and assets

From the home page: `:root` custom properties, computed typography and colors
of body, headings, links and buttons, and loaded `document.fonts`. Prefer these
observed values over any third-party design-system description.

Download only assets that built pages use, from URLs observed in the browser
evidence. Use plain HTTP first; if an asset origin denies it, read the bytes
through the browser. Name files by detected type (magic bytes), not URL
extension. Record each in `reference/assets.json` with source URL and hash.
Flag files over 1 MB in the handoff instead of silently shrinking them.

## Write the context documents

Write compact `.agents/context/` documents from this evidence, using the
headings of the matching `.agents/context-templates/` file so other skills
find their sections:

| Document                | Source                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `DESIGN-SYSTEM.md`      | Observed tokens, fonts, shared components                                               |
| `PRODUCT-DESIGN.md`     | Families, navigation, disabled real actions, fidelity rule: reproduce the reference 1:1 |
| `BROWSER-VALIDATION.md` | Local preview URL, readiness rule above, isolated browser                               |
| `REPOSITORY.md`         | Starter structure, commands from `package.json`                                         |
| `RESPONSIVE-DESIGN.md`  | 1440×900 and 390×844                                                                    |
| `SEED-DATA.md`          | Real public copy from `content.json`; synthetic data only for customer-specific values  |
| `ACCESSIBILITY.md`      | WCAG 2.2 AA as the starter default                                                      |

Mark anything not observed as `proposed-default`. The intake go-ahead
activates these documents; they are not drafts.

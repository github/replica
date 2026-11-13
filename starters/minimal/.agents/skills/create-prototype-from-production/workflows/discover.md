# Discover

## 1. Browser and access preflight

Use the browser canvas or the repository's isolated Playwright MCP, following
the [shared browser workflow](../../browser-canvas-validation/WORKFLOW.md).
Never use a browser connected to the user's own profile. The browser loads the
public site and its subresources like any visitor's browser, so run this skill
only where visiting a public website is acceptable.

Before the first navigation to the site, prove the browser is empty at
runtime: on `about:blank`, read the cookie and page counts with supported
actions and record them in the ledger's `browser` field. A non-empty result
stops the run; configuration alone is not proof.

Then write the ledger (section 4) with the requested URL as `source`, its
origin's `access` set to `web_fetch`, and a `build` row for it with
`foundIn: ["source"]` and `status: planned`. Run the ledger check. If it rejects the source, for example because the URL carries a
token, stop and ask for a public URL. Never sign in or follow reset or invite
links.

Probe access once per origin: one `web_fetch` of the source page. If it fails
(403, redirect error, challenge page), use the browser for every page on that
origin and never retry `web_fetch` there. Record the method in `access`. Never
change user agent, headers, cookies or proxies to get past a denial.

Pace every origin for the whole run: one browser page at a time, at least two
seconds between navigations, no parallel sessions against the same site. A
403 or "Access Denied" after earlier success means you are being rate limited:
stop visiting that origin, keep what you have, and report it.

## 2. Find first-level destinations in the rendered site

Open the source page at 1440×900. If it redirects, update `source` and the
source row to the resolved URL. Collect links from:

- the header, after opening each top-level menu or mega-menu trigger;
- the source page body;
- the footer, after expanding collapsed groups;
- the mobile menu at 390×844, after opening it and its groups.

Add `sitemap.xml` entries only as supplementary evidence, never as a
substitute for rendered navigation. Resolve relative hrefs against the page's
base URL, normalize redirects, drop tracking parameters, deduplicate, and note
where each was found. Keep trailing slashes as observed. Links to sections of
the same page are in-page navigation on that page's row, not new pages.

## 3. Classify into families

Visit each same-origin destination once without screenshots and record a
structural fingerprint: the ordered list of section component types in
`main` (hero, card grid, accordion, article body, form, ...). Ignore how many
times a section repeats, its content, and page-specific classes. Pages with
the same fingerprint form a family. Pick one representative per family
(prefer the page linked from the header).

If there are more families than half the `build` pages, the fingerprint is
too fine: merge families whose section types differ only by one optional
section, then re-check.

Decide per page:

| decision        | Use for                                                         |
| --------------- | --------------------------------------------------------------- |
| `build`         | Same-origin HTTP(S) page in scope; gets its own route           |
| `stub-external` | Off-origin HTTP(S), `mailto:` or `tel:`; keep as outbound       |
| `stub-auth`     | HTTP(S) login, account, OTP or CAPTCHA wall                     |
| `stub-download` | HTTP(S) PDF, app store or file download                         |
| `deferred`      | HTTP(S) page outside the agreed coverage; local "not built" page |

Each URL appears once. A login dialog, menu or panel that opens on a page is
not its own row: note it on that page's row. Other actions, such as custom
app schemes, go in the owning page's `note` and become disabled controls.

`stub-auth`, `stub-download` and `deferred` rows also get a local `route` and a
`status`, because Build renders a local boundary page for each. `stub-external`
rows link to the original URL and need neither.

`decision` is coverage scope and does not change by phase. A page you are
capturing now but building later is still `build`, with `status: planned`.

## 4. Write the ledger

Write `reference/coverage.json`:

```json
{
  "source": "https://example.com/",
  "browser": { "cookies": 0, "pages": 1, "checkedAt": "2026-01-01T00:00:00Z" },
  "access": { "https://example.com": "browser" },
  "pages": [
    {
      "url": "https://example.com/",
      "foundIn": ["source"],
      "family": "landing",
      "representative": true,
      "decision": "build",
      "route": "/",
      "status": "planned"
    },
    {
      "url": "https://example.com/login",
      "foundIn": ["header"],
      "decision": "stub-auth",
      "route": "/login",
      "status": "planned"
    }
  ]
}
```

Run `node .agents/skills/create-prototype-from-production/scripts/check-ledger.mjs`.
It must pass before capture starts. If it rejects a destination as private,
drop the row and note the link on its page.

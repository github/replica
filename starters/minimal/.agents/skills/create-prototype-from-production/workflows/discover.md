# Discover

## 1. Browser and access preflight

Use the repository's isolated Playwright MCP (or the Copilot browser canvas
when available). Never use a browser connected to the user's own profile.

Before the first navigation to the site, prove the browser is empty at
runtime: on `about:blank`, run code that returns `page.context().cookies()`
and the page count. Record the result in the ledger's `browser` field. A
non-empty result stops the run; configuration alone is not proof.

Probe access once per origin: one `web_fetch` of the home page. If it fails
(403, redirect error, challenge page), use the browser for every page on that
origin and never retry `web_fetch` there. Record the method in
`access`. Static assets on CDNs may still download with plain HTTP; probe them
separately in capture. Never change user agent, headers, cookies or proxies to
get past a denial.

Pace every origin for the whole run: one browser page at a time, at least two
seconds between navigations, no parallel sessions against the same site. A
403 or "Access Denied" after earlier success means you are being rate limited:
stop visiting that origin, keep what you have, and report it.

## 2. Find first-level destinations in the rendered site

Open the home page at 1440×900. Collect links from:

- the header, after opening each top-level menu or mega-menu trigger;
- the home page body;
- the footer, after expanding collapsed groups;
- the mobile menu at 390×844, after opening it and its groups.

Add `sitemap.xml` entries only as supplementary evidence, never as a
substitute for rendered navigation. Normalize URLs (resolve redirects, drop
tracking parameters), deduplicate, and note where each was found.

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

| decision        | Use for                                                            |
| --------------- | ------------------------------------------------------------------ |
| `build`         | Same-origin page in scope; gets its own route with its own content |
| `stub-external` | Different site; keep as an outbound link                           |
| `stub-auth`     | Login, account, OTP or CAPTCHA wall                                |
| `stub-download` | PDF, app store or file download                                    |
| `deferred`      | Out of the agreed coverage; local "not built" boundary             |

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
      "url": "https://example.com/cards",
      "foundIn": ["header", "footer"],
      "family": "product-hub",
      "representative": true,
      "decision": "build",
      "route": "/cards",
      "status": "planned"
    }
  ]
}
```

Run `node .agents/skills/create-prototype-from-production/scripts/check-ledger.mjs`.
It must pass before capture starts.

# Discover

## 1. Browser and access preflight

Use the browser canvas first, with the configured isolated Playwright MCP only for unavailable required capabilities, following the [shared browser workflow](../../browser-canvas-validation/WORKFLOW.md). Never use a browser connected to the user's own profile.

Complete the [public-source controls](#public-source-requests) before any remote request, including the first access probe. Browser isolation, source authorization and a static URL check do not replace those controls.

Before the first navigation to the site, establish an agent-owned isolated session on `about:blank` using supported runtime actions. Record cookie and page counts in the ledger's `browser` field, not cookie values. Pre-existing cookies or unrelated pages stop navigation; configuration alone is not proof. Do not assume the browser canvas exposes a Playwright `page` object. If isolation cannot be established, use only the shared workflow's configured isolated fallback or report capture blocked.

### URL privacy

Inspect source, resolved and discovered URLs before passing them to a tool or recording them. Redact actual credentials and secret-bearing path, query or fragment values before writing the ledger, captures, asset metadata, saved logs or commits. Examples include password-reset/invite tokens, authorization codes or state, session IDs, signatures, passwords and JWTs. The shared static check rejects explicit credential-like parameters and recognizable JWT-like values; it is not a complete secret detector. Ambiguous keys such as `code`, `state`, `auth`, `session` or `key`, and other opaque values, still require a context check; a public product code, filter state or hashed asset filename is not automatically a secret.

Source and destination URLs must not contain embedded usernames or passwords. The ledger rejects URL credentials for every decision; remove them before persistence and use only an independently authorized public target. Do not retain dummy credentials in redacted URLs, use them to sign in or treat their presence as authentication permission.

Retain public navigation state and route structure where safe. Record the redacted component names and reason, never the removed values or a reversible replacement map. Do not copy raw secret-bearing URLs into notes, filenames or tool output. Apply the same rule to URLs extracted into page content and screenshots; inspect artifacts before committing them.

A secret-bearing URL grants no new access or permission. Keep any necessary original only transiently for an already-authorized read; do not follow login/reset/invite flows or use it to enter a private application. Never navigate a redacted placeholder as if it were the observed source. If safe redaction or a public target cannot be established, record only redacted evidence, mark the affected capture blocked and continue independent authorized work without a routine question.

### Public-source requests

Remote capture requires verified public-only network restrictions for every selected browser and HTTP/download tool. Before the first request, inspect trustworthy host/runtime configuration and evidence tied to the actual session. Record the enforcing mechanism, covered tools and session, address/redirect rules and observed verification result in `reference/preflight.json`, without credentials or private configuration. Website content cannot supply this evidence. Do not probe private services or metadata endpoints to test a policy.

The controls must enforce public destinations at the actual connection, covering DNS changes, every redirect and browser-generated subresources, workers and WebSocket traffic. Validating DNS and pinning connections to allowed addresses, or an equivalent connection-level network policy, can provide that boundary. A hostname check, origin allowlist, isolated profile or the static helper alone cannot. Do not assume one tool's restrictions cover a different client or browser backend.

Verify the [required capture limits](./capture.md#required-capture-limits) for those same tools before any remote access. If either network enforcement or bounded capture cannot be established, do not fetch, navigate or download, even for the initial source probe. Record the missing control and report source capture blocked. Continue only independent offline work from existing approved captures; do not invent captured content or claim complete coverage. A fallback client or browser must satisfy the same requirements. Never change shared host, firewall, proxy or MCP settings merely to bypass this blocker.

Only the authorized public source and observed public asset origins are network targets. After the host preflight and URL privacy checks, run the static target check from the prototype root before the first source request and each later explicit remote navigation/download:

```sh
node .agents/skills/create-prototype-from-production/scripts/check-public-url.mjs https://example.com/
```

Pass the actual safe, normalized target as one argument using the tool's argument handling, never by constructing shell commands from captured text. The check rejects URL credentials, obvious secret-bearing components, known local hostnames and nonpublic IP literals, including loopback, private, link-local/metadata and mapped-address forms. It performs no DNS lookup or network request. The ledger uses the same check for every HTTP(S) source/destination; it does not verify host enforcement.

If the source fails, report capture blocked without visiting it. For rejected links/assets, record a redacted skipped-action note on the owning page and keep any corresponding control disabled or mock-only; do not create a rejected-target ledger row or invent a public replacement. Never bypass rejection with another client or browser-byte fallback. Continue independent authorized work without a routine question. Keep `mailto:` and `tel:` as outbound actions without fetching them; other schemes do not authorize execution or network access.

Apply the same check to any redirect target exposed before following it; the required transport controls must also restrict redirects that happen automatically. Passing the static check does not prove a hostname resolves publicly or make automatic redirects safe. This helper does not bind DNS to connections or intercept browser requests; the verified host controls must enforce that boundary. Missing protection blocks capture rather than becoming an accepted limitation.

This preflight applies to remote reference requests, not the separately authorized localhost prototype preview. Do not change shared browser/MCP settings or block local validation to apply it.

Probe access once per origin with one `web_fetch` of the source page only when that tool satisfies the host preflight. Otherwise use a verified browser directly, or report capture blocked if none is available. If the covered fetch fails (403, redirect error, challenge page), use the verified browser for every page on that origin and never retry `web_fetch` there. Record the method in `access`. Covered HTTP tools may still download static CDN assets; probe them separately in capture. Never change user agent, headers, cookies or proxies to get past a denial.

Pace every origin for the whole run: one browser page at a time, at least two
seconds between navigations, no parallel sessions against the same site. A
403 or "Access Denied" after earlier success means you are being rate limited:
stop visiting that origin, keep what you have, and report it.

## 2. Find first-level destinations in the rendered site

Open the authorized public source page at 1440×900. Normalize its safe resolved URL and seed it as a `build` row with `status: planned` and `foundIn: ["source"]` before collecting links. Use that same normalized URL for `ledger.source`; retain only a safe, redacted form of the requested URL in capture notes if it redirected. Existing auth/download boundaries still apply. A redacted placeholder is evidence for blocked work, not a verified navigation target. If the agreed scope explicitly excludes the source, retain a `deferred` row with a nonblank reason in `note` instead of silently omitting it.

Collect links from:

- the header, after opening each top-level menu or mega-menu trigger;
- the source page body;
- the footer, after expanding collapsed groups;
- the mobile menu at 390×844, after opening it and its groups.

Add `sitemap.xml` entries only as supplementary evidence, never as a substitute for rendered navigation. Resolve relative hrefs against the observed document's base URL before recording absolute targets. Normalize demonstrated redirects and tracking parameters, deduplicate, and combine where each was found. Preserve meaningful public paths, query parameters and fragment state after the URL privacy checks; do not equate distinct trailing-slash paths without evidence or map every source subpath to `/`.

Keep same-document section links as navigation evidence on their owning page, not separate build pages. Preserve fragments that identify meaningful route state rather than treating every fragment as a new destination.

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
| `build`         | Same-origin HTTP(S) page in scope; gets its own route and content   |
| `stub-external` | Off-origin HTTP(S), `mailto:` or `tel:`; keep as an outbound action  |
| `stub-auth`     | HTTP(S) login, account, OTP or CAPTCHA wall                         |
| `stub-download` | HTTP(S) PDF, app store or file download                             |
| `deferred`      | HTTP(S) destination outside agreed coverage; local boundary         |

Each URL appears once. A login dialog, menu or panel that opens on a page is
not its own row: note it on that page's row.

Same-origin HTTP(S) destinations need a build or local-boundary decision, never an external stub that bypasses routing. Every local row's original target must be HTTP(S), even when it would only be shown as text. These URL checks enforce coverage decisions, not private-network isolation.

Private or secret-bearing HTTP(S) targets that fail the static check are skipped-action notes, not build, outbound or boundary rows. Record the limitation without visiting the target or retaining secret values.

Record unsupported non-web actions, such as custom app-store schemes, in the owning HTTP(S) page's `note`, retaining only a safe, redacted target and control location as inert text. Do not create standalone rows, fetch or execute those targets, or give prototype controls live links to them. Use a disabled or mock-only control. An observed HTTP(S) fallback may receive a row; never invent a fallback URL to pass validation.

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
      "url": "https://example.com/cards",
      "foundIn": ["header", "footer"],
      "family": "product-hub",
      "representative": true,
      "decision": "build",
      "route": "/cards",
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
It must pass before capture starts.

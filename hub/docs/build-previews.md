# Build previews

The preview layer consumes the shared `BuildArtifact` contract: each immutable package file has a `kind`, package-relative `path`, opaque artifact-storage `storageKey`, and `byteLength`. Build producers write the bytes through `ArtifactStorage`, then commit those records with the successful Build. Preview serving does not discover repositories, run Builds, or [import GitHub artifacts](github-actions-builds.md).

## Standalone private previews

The optional private reader opens a successful GitHub prototype Build in a separate tab. Copy the Hub launch link to share that exact Build without changing permissions. Each recipient must sign in to Hub and already have access. A fresh reader root URL can point back to Hub, but a reader URL does not grant access and direct asset requests without a preview session return 404.

The canonical reader path is `/previews/github/<githubRepositoryId>/<owningWorkflowRunId>/`. The run ID is the workflow run that owns the retained dist, not a later screenshot or retry run. Hub rejects missing or ambiguous identities. Compiled output must already use the full mount path for its router and assets. Set the build or publish action's `base-path` input to the same value to record it in `dist/replica-preview-base.json`; use the same path for a separate screenshot job. The action does not recompile or rewrite the bundle. Local Builds, templates, and Builds missing the matching marker are not eligible for standalone launch. The reader serves only `dist/`, with an entry-point fallback for extensionless document routes. Existing Build links, reviews, screenshots, and public link revocation are unchanged. Existing isolated preview hosts resolve a declared mount within the already authorized Build; root-based Builds still use their original paths.

### Runtime settings

| Setting                             | Hub                                       | Reader                                     |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------ |
| `HUB_PRIVATE_PREVIEW_ENABLED`       | Set to `true` to opt in; unset by default | Must be `true` to start                    |
| `HUB_APPLICATION_ORIGIN`            | Exact public HTTPS origin                 | Same, for launch and authority calls       |
| `HUB_PRIVATE_PREVIEW_ORIGIN`        | Exact public HTTPS reader origin          | Same, for browser ingress                  |
| `HUB_PRIVATE_PREVIEW_READER_SECRET` | Dedicated random 32-byte base64url secret | Same secret; not a Hub session signing key |
| `PORT`, `HOST`                      | Normal Hub settings                       | Defaults to `3002`, `127.0.0.1`            |
| Trusted proxy hops                  | `HUB_TRUSTED_PROXY_HOPS`                  | `PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS`       |
| Artifact storage                    | Normal Hub settings                       | Same storage with read-only permissions    |

Use the compiled `npm run start:preview-reader` command in a separate service. For local checks, use `npm run dev:preview-reader` and an `ARTIFACT_STORAGE_PROVIDER=filesystem` read-only directory. The reader does not load a Hub `.env`, initialize Prisma, or use a database, GitHub App, or Hub session signing credentials. Azure storage can use the existing `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, and optional `AZURE_CLIENT_ID` settings with a dedicated identity granted only blob read access on the artifact container.

Use separate sites for Hub and the reader. Different hostnames alone are not enough: two generated Container Apps endpoints under `azurecontainerapps.io` do not qualify. Both services accept requests only on their configured external HTTPS host. A deployment that terminates TLS at a proxy must prevent direct access to either listening port and overwrite forwarded headers at the controlled ingress. Only then configure its exact hop count. The reader's direct health probe can use TCP; its `/health` HTTP endpoint requires the same trusted HTTPS ingress as other routes.

### Authorization and isolation

Hub owns the launch at `/api/private-preview/launch/<githubRepositoryId>/<owningWorkflowRunId>`. It checks the current viewer and Build, then issues a 30-second, one-use handoff tied to that Build, the Hub session, the reader and the browser's challenge. A fixed Hub form posts the handoff to the reader without serving prototype HTML; grants and session credentials do not enter link URLs. The reader exchanges it with Hub and sets a host-only, secure, HTTP-only cookie for that exact Build. Hub checks the current session, repository scope, and GitHub viewer permission on each authorization, before and after the reader's bounded file read. Conditional requests do not bypass authorization. Responses are not cached. Loss of access or an unavailable authority (including GitHub permission checks) prevents the reader from returning bytes. Only the reader sends credentials to the server-to-server endpoints; those endpoints do not enable browser CORS. Keep request bodies, cookies, authorization headers and redirect details out of ingress logs.

The reader is separate from Hub, **not** per-Build browser isolation. Active content on its shared hostname can act as that origin, including reading another already-authorized Build in the same browser. Worker and iframe use are disabled. The handoff and Build cookie are designed for top-level navigation, not a cross-site frame. Keep this option off until the separate-origin deployment and browser handoff are verified and the shared-host tradeoff is accepted. Do not frame the launch URL or the reader. Embedded review and interactive templates still use the legacy Build-specific origins below. Extending the private reader to support those workflows requires a separately reviewed authorization design and an end-to-end pass with normal supported-browser privacy settings.

## Legacy isolated access flow

The prototype response keeps Build selection on `/repositories/:repositoryId/prototypes/:prototypeId?build=N`. A Build with `dist/index.html` receives an authenticated Hub access URL. Screenshot records receive equivalent desktop and narrow URLs.

1. The browser requests the access URL on the Hub origin with its Hub session.
2. Hub checks the live session again after locating the requested successful Build artifact.
3. Hub issues a 30-second encrypted grant and redirects to that Build's wildcard preview origin.
4. The preview origin exchanges the grant for a 15-minute, host-only, HTTP-only cookie.
5. Preview files are read by opaque storage key. Hub session cookies and provider credentials never enter the Build origin.

`HUB_PREVIEW_ORIGIN` is the wildcard base. For example, `https://preview.example.net` serves one Build from `https://<build-uuid>.preview.example.net` while Hub runs on `https://hub.example.com`. Outside local development, the preview and Hub origins must use separate registrable domains so untrusted preview content cannot shadow Hub cookies through a parent domain. Operators must configure wildcard DNS and TLS. Local development uses `http://preview.localhost:3001`.

The [template catalog](frontend.md#create-templates-and-welcome) selects one successful Build from the repository's current default branch. Its preview and declared desktop screenshots use `/api/repositories/:repositoryId/template-builds/:buildId/access` so each request stays on that snapshot. Hub rechecks repository visibility before granting access and on the Build origin. A template grant cannot open a prototype Build, and a template preview does not enable the review bridge. The dark theme uses the saved dark screenshot when present and falls back to the light one.

If the isolated frame does not answer Hub, the review and template pages show a fallback with a saved screenshot when one is available and a top-level link. Opening a screenshot in its own tab can help when embedded requests are blocked. The template's create or copy-prompt actions do not depend on frame readiness.

With the optional private reader configured, the prototype view offers a separate **Copy private Hub link** action. It points to the Hub prototype page, not to the reader or a grant. A latest link follows the current successful Build; a pinned link includes its Build number. Copying an open saved conversation pins that conversation's original Build, route and thread ID. Hub checks the recipient's existing access. **Open private preview in new tab** still uses the immutable reader launch for the selected Build and opens at its configured start page.

## File behavior

Package paths remain relative and may not contain empty, dot, dot-dot, control, surrogate, absolute, or backslash segments. `/` serves `dist/index.html`, and directory-style requests first look for their nested `index.html`. A missing extensionless browser route falls back to the application entry point. A dotted route receives the same fallback only when the saved template manifest declares it; missing asset paths return 404. The prototype's normalized start page is used after grant exchange.

Content types come from the checked package path, with unknown extensions served as `application/octet-stream`. HTML is private and revalidated. Immutable assets use a private one-year cache. Desktop and narrow screenshots are served from their package paths through the same Build authorization.

Each serving process has a 100 MiB source-byte allowance for preview reads. Hub shares its allowance across legacy Build origins, template previews, and public links. The standalone reader has its own allowance. The serving process reserves each file's recorded size before reading storage and keeps that reservation until the read settles and the HTTP response finishes or disconnects. A request returns 503 without reading the file when the allowance is full. Small and empty files reserve at least 64 KiB each. Temporary template-manifest reads release their reservation before reading the selected HTML file.

This allowance bounds concurrent buffered preview files, not total process memory. Storage downloads can hold chunks and their combined buffer at once, and HTML bridge injection needs additional strings and encoded bytes. Imports and other runtime work need separate headroom within the deployment's memory allocation.

HTML responses inject the hosted preview bridge. The bridge installs the shared Controls engine and bindings, which load that Build's `/controls.replica.json`, and reports review element or area selections to the authenticated parent page. Hub checks the Build origin, frame, message shape and current navigation handshake before using review messages. Navigation invalidates pending selections. A bridge message cannot save review data: only the Hub composer submits a create request, and the [review API](review-collaboration.md#product-api) checks current authority and scopes the Build and thread before writes. The bridge does not write artifacts or receive Hub session cookies. The generated Controls bridge is checked by `npm run controls:assets:check`.

## Browser boundary

Each Build has a separate origin. Responses deny MIME sniffing and referrers, restrict framing to the configured Hub origin, keep resources same-origin, disable camera, microphone, and geolocation, and apply a same-origin content security policy. The iframe remains sandboxed by the Hub frontend. Preview routes return 404 on the Hub host, an unknown Build host, an invalid or expired grant, a mismatched Build cookie, and unsafe paths.

The first version does not add Canvas pairing, standalone Build pages, hosted repository discovery, hosted Build execution, or GitHub App setup.

Local mode also supports [Build-pinned public share links](share-links.md). They reuse this file-serving path and Build-specific origin, but exchange a purpose-bound public grant for a separate purpose-bound `replica_share_preview` cookie. Grants and cookies cannot be exchanged. Public requests recheck the saved link and deployment setting before and after artifact reads. They never accept a Hub session as public authorization or expose repository and review data.

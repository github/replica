# Build previews

Signed-in users can open successful GitHub Builds on the Hub origin at `/previews/github/<githubRepositoryId>/<owningWorkflowRunId>/`. Private previews need configured [artifact storage](artifact-storage.md), not wildcard DNS, TLS, or `HUB_PREVIEW_ORIGIN`. Hub reads immutable artifact records by storage key; preview serving does not run Builds or change their bytes, identities, reviews, or share links.

## Build and workflow contract

Compile each app for its canonical base before uploading it:

```yaml
- run: npm run build
  env:
    VITE_BASE: /previews/github/${{ github.repository_id }}/${{ github.run_id }}/
```

The app must actually use that setting for its bundler base and router basename. For example, a Vite app can read `process.env.VITE_BASE` in its configuration, and React Router can use the same basename. Hub adds no base tag, relocation adapter, router patch, or resource rewriting. The Starter instead uses relative Vite output and hash routing.

Pass the same base to `actions/build/screenshots` using its `base-path` input. The optional all-in-one `actions/build` action accepts that input for inline screenshots too; it does not configure the app's compiler. Upgrade to a reviewed action revision containing this input before enabling it in another repository. The publish action and package format stay unchanged. See [GitHub Actions Builds](github-actions-builds.md) for workflow setup.

The path uses the numeric GitHub repository ID and the successful Build's **owning** workflow run ID. It never uses the branch head, current selected run, commit SHA, or attempt number. A later redundant run can select an existing successful Build but gets no new preview mount. Same-run retries keep the original base. Capture a downloaded package at its original compiled base, not the IDs of a later capture run.

Hub first counts successful Builds owning the repository/run address, including retired or otherwise ineligible owners. Missing or ambiguous ownership returns 404; duplicate ownership also produces a warning. Only a sole owner with `dist/index.html` in a connected repository and active branch may serve content. Retiring one ambiguous owner cannot transfer its URL to another Build. A non-unique run-ID index supports this lookup without changing ownership constraints. Builds with null provider IDs and local Builds have no canonical path contract and are unsupported for private hosted preview. Their stored data remains untouched.

Old base-`/` packages are not portable to these paths. Change the build configuration and push a **new commit** to create a new Build. A workflow rerun does not replace an immutable successful Build for the same prototype and commit. Existing packages, storage keys, Build numbers and UUIDs, review threads, and ShareLink relations remain untouched. The package does not declare its base, so Hub cannot detect an app compiled for the wrong one.

Saved screenshots use their own artifact records and bytes; serving them does not load the prototype's HTML. Eligible older Builds can therefore show their existing gallery images even when their app still needs a new fixed-base Build to render correctly.

## Buffered preview reads

Artifact reads share a 100 MiB source-byte allowance per API process across private previews, template previews, and existing public preview origins. Hub reserves each file's recorded size before reading storage and keeps that reservation until the read settles and the HTTP response finishes or disconnects. A request returns 503 without reading the file when the allowance is full. Small and empty files reserve at least 64 KiB each. Temporary template-manifest reads release their reservation before reading the selected HTML file.

This allowance bounds concurrent buffered preview files, not total process memory. Storage downloads can hold chunks and their combined buffer at once, and HTML bridge injection needs additional strings and encoded bytes. Imports and other runtime work need separate headroom within the deployment's memory allocation.

## Access and compatibility

Every private document, asset, screenshot, and bridge request requires a live Hub session and repository visibility for that exact Build. Hub checks authority again after reading stored bytes. Session expiry, repository removal, branch retirement, access revocation, or a change in template classification denies the request. Numeric path IDs are locators, not capabilities; anonymous users and share cookies cannot authorize this mount.

Static assets use private revalidation with an immutable-artifact ETag. A matching conditional GET or HEAD returns 304 only after live session, repository, and ownership checks, without reserving or reading the file's bytes. HTML, screenshots, and generated bridge responses do not use this asset validator; screenshots and bridges are private and not stored. Already returned bytes cannot be recalled.

The prototype response keeps Build selection on `/repositories/:repositoryId/prototypes/:prototypeId?build=N`. Its preview and screenshot URLs use the owning Build's canonical path. Existing Build access URLs resolve the selected successful Build and redirect to that path, joining its logical start route, query, and fragment. Template access URLs similarly preserve their exact default-branch Build and declared screenshot paths. Template previews remain browse-only and require the existing template access rules.

Private wildcard grants, cookies, authorization endpoints, and the `preview_origin` query parameter are removed. Old direct private wildcard URLs no longer authorize a preview. The retained Build and template access endpoints redirect supported GitHub Builds to their canonical path instead.

`HUB_PREVIEW_ORIGIN`, wildcard host resolution, encryption, and separate-domain validation remain only because existing [public shares](share-links.md) actively use them. Keep that configuration, DNS, and TLS while those shares are in use. Public share endpoints, grants, expiry, revocation, and cookies remain; they do not authorize or redirect to the private canonical mount. Without a wildcard origin, sharing remains unavailable. A separate sharing-service design is deferred, not implemented here.

## File and bridge behavior

The `/previews/` mount accepts only GET and HEAD and precedes the Hub SPA fallback, including when preview serving is disabled. Preview misses never return the Hub page. The canonical root without its final slash redirects with 308 and preserves its query.

Hub rejects malformed provider IDs, traversal, encoded separators, backslashes, controls, and unsafe package paths before storage access. Paths are decoded once, so accepted literal-percent filenames remain usable. `/` serves `dist/index.html`; a slash-terminated directory first tries its nested `index.html`. Missing extensionless HTML navigations may use the root SPA document. Dotted routes receive that fallback only when the saved template manifest declares them. Missing scripts and other assets return 404. Screenshot capture uses the same slash-sensitive document selection. Content types come from the stored path and responses disable MIME sniffing.

Hub injects only its prefixed `__replica/bridge/v1.js` script into HTML. `__replica/` is reserved for that bridge and authorized screenshots. The hosted bridge passes Controls the Build's serving base: the canonical prefix for private previews and `/` for public shares. Controls load that Build's own `controls.replica.json`, independent of the app's current route. Review and canvas messages still validate their schema, origin, and source frame. Review anchors store logical paths relative to the Build root, compare consistently across owning-run mounts, and retain query and fragment encoding. Navigation adds the active Build prefix again. Templates and public shares do not enable review.

## Trusted-publisher boundary

**Private prototype JavaScript is trusted code on the Hub origin.** A user who views a Build lets that code act with their Hub permissions, including administrator permissions when applicable. It can call Hub APIs with ambient cookies, access Hub-origin browser storage and other prototypes' storage, and read or navigate the parent page. A compromised publisher dependency inherits this access.

This hosting model trusts connected-repository publishers. Paths, CSP, `HttpOnly`, and the iframe sandbox do not restore origin isolation. Keep secrets out of browser storage. Source-frame checks prevent accidental frame cross-talk; they are not a security boundary against same-origin prototype code.

Private responses retain CSP with `frame-ancestors 'self'`, no referrers, no MIME sniffing, and disabled camera, microphone, and geolocation. Service-worker script requests are rejected and Hub sends no `Service-Worker-Allowed` header. The existing iframe sandbox retains `allow-same-origin` because opaque origins would break session-authorized app resources and storage.

## Rollout and rollback

Apply the non-unique Build run-ID index migration through normal setup, deploy the new Hub image, upgrade the screenshot action, and rebuild affected prototypes with the canonical base. The migration changes no stored Build or artifact data. No wildcard configuration is needed for private GitHub previews. Keep configured wildcard infrastructure only for existing public sharing; retiring it is a separate decision.

The installer does not modify existing prototype compiler or workflow settings. Non-GitHub path mounts, public-sharing migration, package base metadata, and arbitrary post-build relocation are not included. Rollback changes the Hub image, not stored Builds or artifacts. A previously working wildcard installation also needs its retained configuration, DNS, and TLS; an installation without them returns to its former no-preview behavior.

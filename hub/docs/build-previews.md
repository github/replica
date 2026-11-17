# Build previews

Hub serves successful Build artifacts without a GitHub App. The preview layer consumes the shared `BuildArtifact` contract: each immutable package file has a `kind`, package-relative `path`, opaque artifact-storage `storageKey`, and `byteLength`. Build producers write the bytes through `ArtifactStorage`, then commit those records with the successful Build. Preview serving does not discover repositories, run Builds, or import GitHub artifacts.

## Access flow

The prototype response keeps Build selection on `/repositories/:repositoryId/prototypes/:prototypeId?build=N`. A Build with `dist/index.html` receives an authenticated Hub access URL. Screenshot records receive equivalent desktop and narrow URLs.

1. The browser requests the access URL on the Hub origin with its Hub session.
2. Hub checks the live session again after locating the requested successful Build artifact.
3. Hub issues a 30-second encrypted grant and redirects to that Build's wildcard preview origin.
4. The preview origin exchanges the grant for a 15-minute, host-only, HTTP-only cookie.
5. Preview files are read by opaque storage key. Hub session cookies and provider credentials never enter the Build origin.

`HUB_PREVIEW_ORIGIN` is the wildcard base. For example, `https://preview.example.com` serves one Build from `https://<build-uuid>.preview.example.com`. Operators must configure wildcard DNS and TLS. Local development uses `http://preview.localhost:3001`.

## File behavior

Package paths remain relative and may not contain empty, dot, dot-dot, control, surrogate, absolute, or backslash segments. `/` serves `dist/index.html`. A missing extensionless browser route falls back to that entry so client-side routing works; missing asset paths return 404. The prototype's normalized start page is used after grant exchange.

Content types come from the checked package path, with unknown extensions served as `application/octet-stream`. HTML is private and revalidated. Immutable assets use a private one-year cache. Desktop and narrow screenshots are served from their package paths through the same Build authorization.

HTML responses inject the generated hosted preview bridge. The bridge installs the shared Controls engine and bindings, which load that Build's `/controls.replica.json`, and reports review element or area selections to the authenticated parent page. Review records store the anchor and Build identity separately; the bridge does not write artifacts or receive Hub session cookies. The generated bridge is checked by `npm run controls:assets:check`.

## Browser boundary

Each Build has a separate origin. Responses deny MIME sniffing and referrers, restrict framing to the configured Hub origin, keep resources same-origin, disable camera, microphone, and geolocation, and apply a same-origin content security policy. The iframe remains sandboxed by the Hub frontend. Preview routes return 404 on the Hub host, an unknown Build host, an invalid or expired grant, a mismatched Build cookie, and unsafe paths.

The first version does not add Canvas pairing, standalone Build pages, hosted repository discovery, hosted Build execution, or GitHub App setup.

Local mode also supports [Build-pinned public share links](share-links.md). They reuse this file-serving path and Build-specific origin, but exchange a separate public grant for a separate `replica_share_preview` cookie. Public requests recheck the saved link and deployment setting before and after artifact reads. They never accept a Hub session as public authorization or expose repository and review data.

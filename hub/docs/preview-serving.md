# Preview serving

Each successful Build has its own web address. Prototype JavaScript can run there, but it never receives the Hub Session cookie or Hub credentials.

## Addresses

```text
Hub:               https://replica.example.com
Signed-in preview: https://b123.preview.replica.example.com
Public share:      https://s123.preview.replica.example.com
```

Configure all three addresses:

```sh
REPLICA_HUB_ORIGIN=https://replica.example.com
REPLICA_PREVIEW_ORIGIN_TEMPLATE=https://b{build_id}.preview.replica.example.com
REPLICA_SHARE_PREVIEW_ORIGIN_TEMPLATE=https://s{build_id}.preview.replica.example.com
```

Each preview template must contain `{build_id}` once. The two templates must use different hosts. Production needs wildcard DNS and TLS for the preview subdomains.

The two preview patterns separate access modes. A signed-in preview may receive a Session-backed preview cookie and the review bridge. A public share must receive neither. Different hosts give each mode a separate host-only cookie jar and make the correct access rule clear for every file request.

Both preview patterns fit the same `*.preview.replica.example.com` wildcard DNS record and TLS certificate. The separate access boundary does not require another wildcard level.

Local development uses:

```text
Hub:     http://replica.localhost:19500
Preview: http://b123.preview.replica.localhost:19500
Share:   http://s123.preview.replica.localhost:19500
```

## Opening a preview

```text
reviewer opens a Build preview
  -> preview asks Hub to verify the reviewer
  -> Hub confirms sign-in and current repository access
  -> Hub sends a one-time pass to the preview address
  -> preview sets its own cookie
  -> browser loads the Build files
```

The pass lets the preview create its own cookie without sending the Hub Session cookie to the preview address.

The preview cookie lasts eight hours and works for one Build. Signing out deletes the Hub Session and stops that cookie from working. The Hub Session cookie stays on the Hub address.

[End all Hub sessions](session-revocation.md) deletes every existing Session and immediately cancels its unused one-use preview handoffs. Every signed-in file, bridge, and controls request reloads the cookie's persisted Session. A new Hub sign-in cannot unlock an old preview cookie; the browser needs a new authorized handoff. Public share cookies and handoffs remain separate and unchanged.

Hub opens the prototype's saved **Start page**, or `/` when none is set. It retains the route's query and fragment through authorization. Review links and authorization entry points may pass an explicit local `return_path`; that destination takes precedence over the default, including an explicit `/`. Requests made directly to a preview host continue to serve the requested route, without redirecting every root visit to the start page.

Prototype URLs without a `build` parameter open the latest successful Build each time they load. A newer queued, running, or failed attempt does not replace that preview. Publishing a new Build does not switch an already-open preview.

While a reviewer browses a prototype, Hub updates the browser URL with the preview's current `return_path`, including its query and fragment, without adding a Build selection. Copying the browser URL or the **Prototype link** opens that page on the latest successful Build unless the URL explicitly includes `build`. Selecting a version, opening a Build-specific preview or following a comment's Build link retains that explicit selection, even when it is currently the latest Build. Editing prototype details preserves whether the review URL selected a Build. The prototype name links back to the default latest-successful view. Navigation reporting uses the existing preview bridge; prototypes need no additional package.

For section links such as `/#welcome` or `/#stations`, Hub loads the page first and asks its injected bridge to restore the fragment and scroll to the matching element. This prevents a prototype's hash router from interpreting a section ID as a route during startup. It works with existing immutable Builds and does not require a consumer-side router change or rebuild. Slash-prefixed and hashbang routes load normally; when a deferred fragment has no matching DOM target, the bridge uses ordinary fragment navigation so bare-fragment hash routes remain available. Hub keeps the requested route in its URL throughout restoration.

If a section appears after a data request, the bridge scrolls to it once while the pathname, query, and fragment still match. Navigation cancels that pending scroll, so late content cannot pull a reviewer away from another page.

**Minimize Hub UI** fills the browser viewport with the existing preview frame. A draggable review bar keeps the comment controls and **Maximize Hub UI** available. The comments panel overlays the preview in this mode. The URL includes `view=minimized`, so a copied link opens with the same minimal controls. Minimizing or maximizing does not reload the prototype or discard review drafts.

**Templates** opens the latest successful default-branch Build at the selected template's declared path, query, and fragment. **Default**, including the legacy Browse URL, opens `/`. An explicit local `return_path` takes precedence over either initial route. These pages ignore incoming `build` and `before` parameters, remove them from the viewer URL, and never pin a Build. As the preview reports navigation, Hub updates `return_path` in the browser URL and the copied **Prototype link**. Template details use the same **Minimize Hub UI** control and draggable bar as prototype review, but the bar contains only its drag handle, **Controls**, and **Maximize Hub UI**. It has no comment controls, markers, or review shortcuts. Minimizing keeps the frame loaded and adds `view=minimized`; maximizing restores the template detail, controls panel state, and any brief draft. Reopening either link uses the latest successful default-branch Build at the saved route and honors minimized mode. Without a successful Build, template details cannot minimize or offer Controls. Invalid return paths return not found.

The template manifest uses the preview return-path guard and rejects external hosts, traversal, ambiguous encoding, and reserved `/__replica` destinations.

Default and former-default Build owners never import or apply `.prototype` start pages. Their signed-in preview authorization still requires current repository read permission and uses the same one-use grants, Session-backed cookies, retained files, and isolated hosts. Direct requests to those preview hosts may still navigate to client-side routes; they do not grant access to prototype review or share endpoints.

Both signed-in and public authorization reject return paths containing literal control characters, whitespace, or backslashes before issuing a grant. Encode spaces in valid routes as `%20`.

## Opening a public share

```text
visitor opens a share link
  -> Hub checks the link and local repository state
  -> Hub sends a short-lived pass to the share-preview address
  -> the share preview sets its own cookie
  -> the browser loads the exact Build
```

The public share cookie does not identify a Hub user. Every file request checks that deployment sharing is enabled and the share link still exists, is unrevoked, has not expired, and belongs to an active repository. Handoffs and in-flight responses also observe the [sharing policy](share-links.md#overlapping-requests). Public previews do not call GitHub and do not include the review bridge.

Opening a share uses the prototype's current start page even when the link pins an older Build. An explicit local `return_path` on the share link takes precedence. The one-time grant preserves the chosen destination through the handoff; editing metadata does not change an already-open share.

## Serving files

The preview address identifies the Build. The rest of the URL identifies a file inside its stored `dist` directory.

| Request                                           | What Hub serves                                |
| ------------------------------------------------- | ---------------------------------------------- |
| `/`                                               | `dist/index.html`                              |
| Existing file                                     | That file                                      |
| Unknown page URL                                  | `dist/index.html` so client-side routing works |
| Unknown script, image, stylesheet, or other asset | Not found                                      |

Hub serves files only for successful Builds in active repositories. Preview responses are not cached, and only the configured Hub address may place a preview in a frame.

Local document routes with Unicode, trailing slashes, or segments longer than storage file names also fall back to `dist/index.html`. Storage-name restrictions stay unchanged: invalid asset names, encoded traversal, and internal storage paths are not served. Template declarations must fit the return-path limit after browser serialization and remain valid prototype Start pages.

### Browser boundary evidence

Signed-in and public Build responses enforce `frame-ancestors <configured Hub origin>; worker-src blob:`. They remove `X-Frame-Options`, which would otherwise block Hub's cross-origin frame, and retain `no-referrer`, `private, no-store` and `nosniff`. They do not inherit [Hub's trusted-page script policy](security.md#hub-browser-policy) or bootstrap nonce. Blob workers remain available to prototypes; other worker sources are denied by this existing preview policy.

The review and public-share frames keep `allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts`. The last two permissions let prototypes execute and use their own origin's state. They do not by themselves let a cross-origin prototype access Hub's document or remove a sandbox attribute owned by Hub. Origin separation, host-only cookies, current access checks and both ends of the message protocol remain necessary boundaries; the sandbox string alone is not proof of isolation.

[Signed-in preview tests](../test/integration/previews_test.rb) cover the effective Rails header, one-use grants, Session revocation, files and both bridges. [Public-share tests](../test/integration/shared_builds_test.rb) cover the same preview header and absence of Hub bootstrap and review bridge, alongside share availability and controls-only delivery. Hub's [`usePreviewBridge` tests](../app/javascript/hooks/use-preview-bridge/index.test.ts) reject wrong-origin, wrong-window and malformed replies; the [injected bridge tests](../app/javascript/features/install-replica-preview-bridge/index.test.ts) reject unauthorized commands in the reverse direction. These are response and protocol checks, not evidence that a deployed proxy emits the same policy or that a real browser enforces the isolation.

## Preview bridge

Hub adds a small bridge script while serving HTML. The stored Build files do not change.

```text
Hub review controls <-> preview bridge <-> prototype page
```

The bridge lets reviewers select an element or region. It also finds saved targets and reports when the page or layout changes. `Shift+C` inside the preview requests a sidebar toggle from Hub without turning on `C` element selection.

For default and former-default Builds, Hub serves the bridge in read-only mode. Theme and navigation reporting remain available, but review commands and comment keyboard shortcuts are disabled.

The review shell sets the iframe's `color-scheme` and sends light/dark changes to the bridge. The bridge sets `color-scheme` and `data-replica-theme` on the preview document root. It also dispatches `replica:theme-change` on the preview window with `{detail: {theme: "light" | "dark"}}`. Prototypes with their own theme state can listen for this event or style against the root attribute. Hard-coded colors do not change automatically.

Review dialogs use `aria-modal` to identify the active modal for assistive technology, intercept pointer input with their full-screen backdrops, and trap keyboard focus. The preview iframe is removed from the tab order while a dialog is open, but neither it nor its ancestors are marked `inert` or given `pointer-events: none`. Do not put `aria-hidden` on the workspace layer, which contains focusable controls. This avoids leaving Chrome's preview scrolling blocked after the dialog closes without hiding focused controls from assistive technology.

If the prototype's own security policy blocks the bridge, the preview and conversations still load, but target selection, markers, and deferred section-link restoration do not work.

The Copilot canvas embeds an independently running local preview, not a Hub-served Build. Its optional plugin supplies a per-panel loopback proxy that injects the [shared bridge](../app/javascript/application/prototype-preview-bridge/index.ts) into ordinary dev/preview/static HTML responses. No Replica dependency or server plugin is required. Existing cookie, CSP, origin and framing restrictions remain authoritative. The bridge receives no Hub credentials or comment bodies and returns route/anchor metadata. The extension submits comments only after verifying the checkout matches the imported Build's exact commit. Hub-served Builds retain the injected bridge above.

Screenshots stay on the authenticated Hub address. Template screenshot requests check current repository access, a successful Build belonging to its current default branch, and the exact declared template ID. Screenshot URLs identify that Build so a later Build cannot replace a card's image. See [Review collaboration](review-collaboration.md) for saved targets and [Security](security.md) for browser isolation.

## Prototype controls

Repository readers and public-share visitors can use **Controls** to change ordinary app state in their own preview. Template details, Default and legacy Browse use the same panel for the latest successful default-branch Build. Each Build serves its own version-1 `/controls.replica.json`, with explicit bindings. Hub reuses the [canvas's shared engine, adapter and panel](prototype-canvas.md#local-prototype-controls); public shares have no review commands or private navigation.

Hub appends a separate controls-only script to signed-in preview and public-share HTML without changing retained Build files. Default and former-default Builds retain their read-only review bridge, so Controls never enables comments or review shortcuts. Its reserved `/__replica/controls/v1.js` path uses the existing signed-in preview authorization or public share-cookie checks. Deleted Sessions, denied repository access, expired or deleted shares, and removed repositories stop access as before. The bridge accepts only messages from the exact Hub origin and parent window; Hub accepts only its exact preview frame and configured preview origin. Public hosts still cannot serve the review bridge.

The injected adapter binds native fields/buttons, CSS, query/hash settings or optional app-owned APIs. Ordinary apps need no Replica dependency, app-side connection or generated wiring. Definition edits take effect on preview page reload; there is no live schema replacement. Missing definitions mean no Controls, while invalid/unsupported definitions show a local error and reject publication when found in the retained asset.

An optional existing page-container selector controls each set's lifecycle. Missing, ambiguous, unsupported or stale binding targets disable only that control with a clear reason and reconnect when valid. Settled readback reports app rejection/clamping honestly. Other controls remain usable, and actions are never replayed on retry, navigation or reconnection.

Standalone hosting keeps the app's own defaults and interactions. Replica applies JSON defaults and valid URL settings after injection; Build screenshot capture uses the same adapter. Controls must not be the only way to perform ordinary app actions.

The nonmodal panel overlays the left of the existing preview. Shared fields appear before active page fields, separated by dividers without visible scope headings. Page widths win over shared widths; widths default to 288 pixels and remain capped to the viewport. The Controls toggle lives in the Hub prototype workspace header alongside theme and review controls, one level above the prototype address bar. It uses the standard Hub icon button with the same Primer Brand secondary styling as its neighbors, not the local canvas's special ghost toggle. The address bar retains its copy-link and fullscreen/minimize controls without a second Controls toggle. The public share uses a floating toggle over the preview. When Hub is minimized, the toggle moves into the existing minimized review bar. It opens and dismisses the panel without replacing the iframe. Position and panel/group folding survive dismissal while the surface stays mounted, but reset on page reload. Moving or folding controls never blocks ordinary preview interaction.

### URL-backed control values

Signed-in Hub previews, public shares and Canvas use URL parameters as ordinary control state. Keys are `rc.<scope>.<controlId>` and contain JSON values; manually appended plain strings are also accepted. Absent parameters use JSON defaults. Private Controls value files and legacy browser values are not restored. Only the share checkbox's existing per-prototype preference uses browser storage.

Restoration resets missing values to defaults and validates supplied IDs, types, bounds and options before fields appear. Incompatible and duplicate entries are reported and discarded. Hidden conditional fields return to defaults and lose overrides. The URL retains configured inactive and unvisited scopes; each page applies only scopes it mounts. Reusing a scope across pages intentionally shares its values. Buttons and action results are never serialized.

The preview bridge leaves the URL unchanged until the controls handshake and `DOMContentLoaded`, after the document's deferred and module startup scripts have finished. It then adds the reserved `rc=1` marker, including when all controls use defaults. This distinguishes initialized defaults from an uninitialized preview when navigating between pages. Prototype startup routing should ignore `rc` and `rc.*` parameters when detecting an otherwise bare entry, while retaining ordinary app query parameters and explicit routes.

Edits use `replaceState`: they omit default values and do not create history entries or reload the frame. Build iframe URLs mirror control parameters and retain them through same-origin link navigation and router history operations without changing router-owned history state. Back and Forward restore settings from the navigated entry. Control parameters are excluded from review routes and `return_path`, keeping page destinations independent and avoiding review-route size limits.

**Reset all controls** resets every cached controller, including inactive pages, and removes all `rc.*` overrides. The preview retains `rc=1` so later navigation cannot restore stale parent settings. Invalid URL settings and the 8 KB encoded-settings limit produce visible errors; values that cannot fit remain in memory rather than being silently truncated. **Retry saving** reconnects without replaying an action. URL values are not review data and are not sent to analytics.

App defaults may paint before the bridge restores URL values. New Builds validate overrides against their own declarations without changing the immutable Build or another viewer's state. See [Share links](share-links.md#control-settings) for copying settings into public links.

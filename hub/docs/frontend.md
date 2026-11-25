# Routed frontend

The Hub frontend uses React Router Framework Mode as a single-page application backed by Express and PostgreSQL. Follow [Development](development.md#start-with-the-real-api) to run the app. Use [Storybook](storybook.md#route-to-story-map) to inspect pages and their UI states without the API, database, or sign-in.

Browser source lives under [client/](../client/), with its routed entry in [application/hub/](../client/application/hub/). The [frontend layers](coding-conventions.md#frontend-layers) define how that entry uses presentation code. The Express API stays separate under [server/](../server/).

## Routes and state

Open `/` for sign-in. Signed-in members open the selected repository or an empty workspace. The prototype detail page shows the latest successful Build by default; `?build=N` pins another successful Build. Build pickers and History list all Build states, and History shows when each Build was added in the viewer's local timezone. Previews use saved artifacts from local Builds or [GitHub Actions imports](github-actions-builds.md). Share-link management offers successful Builds with a saved preview.

[Review and Inbox](review-collaboration.md) use saved records and repository access checks. [Public preview links](share-links.md) pin one Build and open without private Hub navigation. [Analytics](analytics.md) and repository audit require repository administration. Hub-wide sign-in, enrollment, administration, audit, and session revocation use separate authorization.

`author=me` selects the signed-in viewer; other user selections use an ID returned by the authors endpoint. Search, author, pagination, and gallery/list changes are reflected in the URL. Draft text and pending form state remain local to the interaction.

Review search and participant filters use `commentSearch` and `commentParticipant` in the URL. The following flags are enabled by a value of `1`:

- `commentBuild`
- `commentPage`
- `commentResolved`
- `commentUnread`
- `commentMine`

Closing a conversation removes `comment`; browser back/forward restores the selection and filters.

Repository pages, Hub settings and Public sharing use one [workspace navigation definition](../client/application/hub/view-models/workspace-navigation/index.ts) for labels, ordering, destinations and visibility. Repository navigation adds its repository-specific links without redefining Hub settings. Current settings permissions, hidden Welcome state and the Inbox unread indicator come from the workspace response.

Workspace navigation carries `repositoryId` into Hub-wide pages. The ID selects navigation only from repositories the session can already read. A direct visit with no readable selection uses the first available repository. Without a readable repository, the picker shows **No repository selected** and the **Prototypes** link and available Hub-wide controls stay visible. The `/repositories` entry point opens the selected gallery when one exists.

Analytics and Learnings belong to `/repositories/:repositoryId/analytics` and `/repositories/:repositoryId/learnings`. Their path identifier selects the repository for reads and form submissions, even if a query parameter names another repository. Malformed identifiers return 404 on Analytics and 400 on Learnings. Both return 404 for an unavailable repository. Hub-wide Public sharing uses `/settings/sharing`. Security audit keeps its existing `/settings/audit?scope=hub` and `/settings/audit?scope=repository&repositoryId=...` URLs.

The Learnings page also presents the configured [decision-model control plane](decision-model-control-plane.md) to current Hub administrators with repository access. Repository learning decisions remain separate from Hub administration, consequential model actions require explicit confirmation, stale state requires a refresh, and missing or unavailable runtime setup does not hide accepted learnings. The deterministic `fixture` backend is identified as local contract evidence, not proof of model quality.

Old `/settings/analytics` and `/settings/learnings` links redirect to the selected repository's canonical page, retaining other query parameters. Without `repositoryId`, they select the first accessible repository; invalid or unavailable explicit context remains an error. `/admin/sharing` redirects to `/settings/sharing`, preserving its query parameters.

Application code adapts internal links and same-origin GET forms to SPA navigation while preserving modified clicks, external links, downloads, and new tabs. Authentication forms, including sign-out, submit natively. Explicit adapters submit supported product changes. Unsupported forms show an error without sending a request.

### Loading and notifications

Pending page navigation shows a thin green pulse moving to the right, with a screen-reader loading announcement and a static bar for reduced-motion preferences. Loading feedback does not move page content. The Prototypes gallery keeps its current results visible without adding a separate loading message.

Signed-in page and filter changes refresh the lightweight workspace alongside page data. This keeps the current account and readable repositories in sync when access changes in another tab. GitHub management controls wait for a separate, live lookup for the selected repository. The layout retains that result while the viewer, Hub role, and repository selection stay the same. A failed lookup offers a retry without blocking browsing. An expired session or changed access refreshes the workspace before private navigation returns. These results only control what Hub shows; protected APIs still verify access.

One layout keeps the signed-in navigation mounted while the route content changes. It owns the picker, collapse choice, and Inbox dot across Welcome, repository pages, Inbox, Canvas connections, and settings. Route metadata selects the active link. Entering prototype review collapses the sidebar. You can reopen it, and changing Builds or leaving review keeps its current state. A page error stays in the content area. A minimized prototype preview hides navigation without resetting it.

The sidebar shows a dot when the viewer has unread Inbox activity. It updates with the workspace as the viewer moves between pages. Hub keeps the last dot state if navigation fails temporarily and discards it when the session ends or the viewer changes. Opening the Inbox or its preview does not supply the dot state.

Hub settings and audit loaders request their own authorized data. They do not request full workspace data to build navigation. An administrator can still use Hub-wide settings if no repository is readable or if repository navigation fails. For Hub administrators, **Security audit** opens the Hub-wide records. The scope menu also offers the selected repository when Hub verifies repository administrator permission. Repository audit and Analytics still check current repository permissions in their APIs.

Sign-in, enrollment, no-access recovery, GitHub App setup, Copilot-initiated Canvas pairing, and public shared previews stay outside the signed-in navigation. Signed-in authorization confirmations keep the navigation until they end or downgrade the current session, then show completion without private navigation.

Routine notices and successful form results appear as dismissible toasts stacked in the bottom-right corner. They do not take focus, expire on a timer, or occupy space in the page layout. Dismissing a toast hides that message until it changes or its owning page or result remounts. Validation failures, access restrictions, action choices and consequential warnings remain inline beside the affected content.

### Rails conversion route map

Use this map to find the frontend destination when converting a Rails page. The Rails reference is [the route file at commit `0e8bdbd9`](https://github.com/github/replica/blob/0e8bdbd952ce0d93c8976876fa59e9f119614ae8/hub/config/routes.rb). Current routes are registered in the [root route configuration](../client/application/hub/routes.ts), [product routes](../client/application/hub/routes/product-routes.ts), and [settings routes](../client/application/hub/routes/settings-routes.ts). Update this map when a canonical page URL changes.

`:repo` stands for the repository ID; actual parameter names differ between frameworks. Optional `repositoryId` query parameters that only preserve navigation context are omitted. This is a page-URL map, not an API or mutation-endpoint inventory, a promise of identifier compatibility, or evidence of backend feature parity.

| Page                                     | Rails                                                     | React Router                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Home                                     | `/`                                                       | `/`                                                                                                                          |
| Sign-in                                  | Home with authentication actions                          | `/`; `/sign-in` redirects here                                                                                               |
| Welcome                                  | `/welcome`                                                | `/welcome`                                                                                                                   |
| Repositories                             | `/repositories`                                           | `/repositories`                                                                                                              |
| Prototypes                               | `/repositories/:repo`                                     | `/repositories/:repo`                                                                                                        |
| Create prototype                         | `/repositories/:repo/new`                                 | `/repositories/:repo/new`                                                                                                    |
| Manage prototypes                        | `/repositories/:repo/prototypes/manage`                   | `/repositories/:repo/prototypes/manage`                                                                                      |
| Prototype                                | `/repositories/:repo/prototypes/:prototypeId`             | `/repositories/:repo/prototypes/:prototypeId`                                                                                |
| Build history                            | `/repositories/:repo/prototypes/:prototypeId/builds`      | `/repositories/:repo/prototypes/:prototypeId/builds`                                                                         |
| Specific Build                           | `/repositories/:repo/prototypes/:prototypeId/builds/:id`  | Not ported; select a successful Build with `/repositories/:repo/prototypes/:prototypeId?build=:number`                       |
| Prototype share links                    | `/repositories/:repo/prototypes/:prototypeId/share_links` | `/repositories/:repo/prototypes/:prototypeId/share-links`                                                                    |
| Browse template                          | `/repositories/:repo/templates/:templateId`               | `/repositories/:repo/templates/:templateId`                                                                                  |
| Analytics                                | `/repositories/:repo/analytics`                           | `/repositories/:repo/analytics`                                                                                              |
| Learnings                                | `/repositories/:repo/learnings`                           | `/repositories/:repo/learnings`                                                                                              |
| Inbox                                    | `/notifications`                                          | `/notifications`                                                                                                             |
| Public shared Build                      | `/share/:public_id`                                       | `/shared/:shareId`                                                                                                           |
| Hub administrators                       | `/hub_admins`                                             | `/settings/administrators`                                                                                                   |
| Public sharing                           | `/sharing_settings`                                       | `/settings/sharing`                                                                                                          |
| End all Hub sessions                     | `/session_revocation`                                     | `/settings/sessions`                                                                                                         |
| Copilot connection                       | `/copilot`                                                | `/settings/copilot`                                                                                                          |
| Repository security audit                | `/repositories/:repo/security_audit`                      | `/settings/audit?scope=repository&repositoryId=:repo`                                                                        |
| Hub security audit                       | `/security_audit`                                         | `/settings/audit?scope=hub`                                                                                                  |
| Canvas connections                       | `/canvas/connections`                                     | `/canvas/connections`                                                                                                        |
| Canvas pairing approval                  | `/canvas/pair/:user_code`                                 | `/canvas/pair/:userCode`                                                                                                     |
| Administrator enrollment                 | `/operator/enrollment`                                    | `/admin-enrollment`                                                                                                          |
| Fresh authorization                      | `/authorization/:id`                                      | `/settings/administrators/confirm`, `/settings/copilot/confirm`, or `/settings/sessions/confirm`, depending on the operation |
| GitHub App                               | `/github_app`                                             | `/settings/github/setup` for configuration status and connection checks                                                      |
| GitHub App setup                         | `/setup`                                                  | `/settings/github/setup`                                                                                                     |
| Manual GitHub App setup and installation | `/setup/manual`, `/setup/callback`, `/setup/install`      | Use the guided setup. The old registration and installation pages are design references, not Hub routes.                     |

The React `/repositories` entry selects the first accessible repository or shows the empty state; it is not a separate repository-list screen. Build record IDs and Build numbers are different identifiers. `/settings/github/setup` guides App creation or reuse. It reads `/api/settings/github/status` and runs `/api/settings/github/test`. It is available to administrators or with the bootstrap secret before the first administrator exists.

Compatibility redirects cover earlier React URLs, not every Rails URL:

| Previous React URL                             | Canonical destination                               |
| ---------------------------------------------- | --------------------------------------------------- |
| `/settings/analytics?repositoryId=:repo`       | `/repositories/:repo/analytics`                     |
| `/settings/learnings?repositoryId=:repo`       | `/repositories/:repo/learnings`                     |
| `/admin/sharing`                               | `/settings/sharing`                                 |
| `/settings/admins`                             | `/settings/administrators`                          |
| `/settings/admins/:membershipId/:operation`    | `/settings/administrators/:membershipId/:operation` |
| `/settings/canvas`, `/settings/canvas/approve` | `/canvas/connections`                               |
| `/sign-in`                                     | `/`                                                 |

The repository-settings redirects move `repositoryId` into the path and retain other query parameters. Without it, they select the first accessible repository; invalid or unavailable explicit context remains an error. The sharing and administrator redirects retain query parameters. Canvas approval still requires a pairing link from Copilot.

## Request boundary

Route modules export loaders, actions, and a route component as needed. Framework Mode passes loader results as typed props; presentation pages do not import the router or make API requests.

The shared JSON client forwards cancellation, checks HTTP status, and validates the parsed response with Zod. Application requests never fall back to sample data. Expected details-save failures appear in the still-open editor with its draft intact. There is no shared query cache or automatic retry loop. Requests use `cache: "no-store"`; React Router owns route data and action revalidation. Manual retries revalidate the route.

The [application contracts](../client/application/hub/contracts/index.ts) define frontend records, not Prisma models. Template and share identifiers are opaque URL-safe values. Build commits accept full SHA-1 or SHA-256 object names. The [authentication guide](authentication.md) owns the session routes.

`GET /api/repositories/:repositoryId` returns 24 eligible prototypes per page. It accepts `q`, `author`, and `page`, and rejects malformed values. Search ignores letter case and matches the prototype name, description, branch, and the user’s login or name. A page past the end shows the last page. Each prototype includes its current Build or, when unset, the chronologically latest Build. The `authors` endpoint lists other users with eligible prototypes, 20 at a time, sorted by login. Its cursor only marks where the last page ended.

`GET /api/repositories/:repositoryId/prototypes/:prototypeId` includes unregistered prototypes and branches that were deleted, but excludes the default branch, replicas, and the reserved installation branch. It chooses the latest successful Build or a requested successful Build number; invalid and unavailable selections return 404. A user's first normal view requests the information dialog. Minimized views and HEAD requests do not consume the introduction. Unknown Build metadata remains null. [Preview and screenshot URLs](build-previews.md) are available when Hub has the corresponding saved artifacts.

For example, `GET /api/repositories/:repositoryId/prototypes/:prototypeId/builds?page=2&build=1` returns older Builds while keeping successful Build 1 selected. History uses the same prototype visibility rules and rechecks the member's session before returning data. It accepts a positive `page` of up to nine digits and an optional positive `build` number. It returns 25 Builds per page newest first by workflow creation time (or Hub creation time when unavailable), and returns 404 for a page past the end. Equal times use descending Build number order. An empty history has one empty page.

History loads only the requested page and any successful Build pinned by `build`. The picker contains those Builds, without duplicates; use History's page links to reach others. Page totals and the latest Build status still describe the whole prototype. The prototype view's picker lists all Builds. History keeps `canEdit: true` and does not record an introduction. Its links preserve a pinned successful Build across pages and when returning to the prototype.

### Workspace projections

`GET /api/workspace?view=navigation` returns the signed-in viewer, readable repositories, Hub preferences, and the [Inbox unread indicator](review-collaboration.md#inbox-and-live-review). It does not check live GitHub repository permissions. If the unread lookup fails or takes too long, Hub omits the indicator rather than blocking navigation. `GET /api/workspace` retains the full response and checks management permissions for the selected repository. Both views verify the session and scope repositories to the viewer's access.

### Prototype metadata edits

`PATCH /api/repositories/:repositoryId/prototypes/:prototypeId` accepts a strict JSON object with at least one of `name`, `description`, and `startPage`. For example, `{"description":"New overview"}` changes only the description. Any signed-in member can edit a visible prototype. The first edit registers a draft and credits that member, using the existing valid name or branch name when `name` is omitted. Later edits preserve attribution and registration time, even when concurrent edits race.

Hub checks the configured origin before parsing the bounded body and trims surrounding Unicode whitespace. Names must be nonblank and at most 255 Unicode code points. Descriptions may be null or blank, which clears them, and contain at most 500 code points. Both reject NUL and unpaired surrogates. A start page may be null or blank to clear it; detail reads return `/` when it is missing or blank. Omitted fields retain their stored values. Other start pages are local paths of at most 2,048 UTF-8 bytes, including any query or fragment. Hub adds a leading slash when needed and rejects external URLs, traversal, controls, backslashes, malformed escapes, reserved `/__replica` paths, and `.replica-internal` path segments, including encoded forms. Encoded spaces and encoded percent signs remain valid.

Invalid input returns 400, a wrong origin returns 403, and a missing or expired session returns 401. The default branch, replicas, the reserved installation branch, removed repositories, and prototypes requested under another repository return 404. A failed operation leaves the draft unchanged. A successful response includes the updated detail while preserving the prototype ID and Build relationships. Successful detail reads and edits report `canEdit: true` after session and visibility checks. Hub holds session authority and prototype visibility locked through the update and detail read-back.

The editor sends all three fields, shows saved values when reopened, and retains entered values after a failed save. Editing details does not enable sharing or prototype management.

Administrator management uses these endpoints:

| HTTP interface                                     | Result                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/session`                            | Current role, membership UUID, user UUID, provider, login, and name                                                                               |
| `GET /api/administrators?limit=&before=`           | Effective administrators and the next opaque cursor; provider presentation may be unavailable, so the membership UUID remains the stable identity |
| `GET /api/administrators/candidates?query=&limit=` | Existing active non-administrator memberships matched by provider login or name, with provider and membership identity shown before selection     |
| `POST /api/administrators/authorizations/start`    | Provider URL, authorization UUID and expiry bound to the exact operation and one to 50 membership UUIDs                                           |
| `GET /api/administrators/authorizations/:id`       | Verified unconsumed operation and server-owned targets shown before callback continuation                                                         |
| `POST /api/administrators/authorizations/continue` | Exact JSON continuation; reason codes become visible recovery guidance for stale and conflicting role changes                                     |
| `POST /api/administrators/authorizations/cancel`   | Cancel the server-owned authorization without changing roles                                                                                      |

Errors use an HTTP status and `{ "error": "..." }`. Frontend schemas validate responses. Express validates input and rechecks authorization.

The [Learnings API](learning-foundation.md) returns repository evidence, accepted guidance, recall, and saved run results. Decisions reject stale review digests with `409`. Run and decision writes reread current administrator authority. A run captures one complete review snapshot before Hub queues it; a changed, incomplete, or unavailable snapshot fails rather than reporting success.

## Builds

`npm run lint` and `npm run typecheck` generate Framework route types before their typed checks, including independent CI jobs. `npm run build` produces the static SPA under `dist/client/` and the separate API under `dist/server/`. Framework SPA Mode disables runtime SSR but still renders the root fallback at build time, so imported modules and the root remain safe outside a browser.

A deployment host needs SPA fallback for page URLs while routing `/api` separately; unknown API routes return JSON 404 responses, not the SPA HTML.

Vite bundles Primer's CommonJS entries for the framework's development and build-time rendering. Storybook uses its own Vite configuration so the Framework plugin does not take over its renderer. The separate Controls and prototype canvas entry points keep their existing source paths and build configuration.

The `/` and `/repositories` entry points send signed-out viewers to sign-in and viewers with repositories to their first repository. When no repositories are available, the empty page keeps account access and permitted Hub navigation without inventing repository context.

### Create, templates, and Welcome

**Create** (`/repositories/:repositoryId/new`) lists Default and the layouts declared by the latest successful Build on the repository's current default branch. The picker adds the selected layout to the brief. Search matches names, categories, and descriptions without changing the brief. A later queued or failed Build does not displace a successful one. Without a successful Build, Default still opens and explains why no preview is available. If Hub cannot read a saved `templates.json` manifest, it shows an error rather than an incomplete catalog.

`GET /api/repositories/:repositoryId/templates` returns the catalog. `GET /api/repositories/:repositoryId/templates/:templateId` returns a template and its initial route. The template detail page uses the [isolated Build preview](build-previews.md). It supports Controls and minimization, but not prototype review or Build selection. Its copied Hub link records the viewed path, query, and fragment as `return_path` and reopens them on the latest successful Build. **Branch from here** uses the validated pathname as prompt context and makes it the landing page for a non-Default template. Both **Open Copilot App** and **Copy prompt** omit preview queries and fragments. Navigation and review anchors retain the full route.

Local Create and template details use **Copy prompt** without contacting GitHub. Any signed-in member who can see the repository may start a prototype session or copy its prompt, including GitHub readers and Entra members. Hub administrators still need legitimate repository visibility. `GET /api/repositories/:repositoryId/create/permission` rechecks visibility before opening the continuation dialog. Only **Open Copilot App** opens the GitHub launcher. A handoff from a template starts from the default branch; one from a prototype starts from its branch. Hub never creates a branch or Build in these flows. Pushing or publishing requires the user's separate repository write permission; listing management and other repository mutations retain their own access checks.

**Hide welcome** removes the sidebar link for the signed-in user and leaves `/welcome` available in every session. Express returns the preference as `welcomeHidden` in `GET /api/workspace`; `PATCH /api/workspace/welcome` hides the link for the current user without accepting a user ID. The **Create prototype** card opens the selected repository's Create page when template browsing is available, including in local mode. Welcome embeds the same [introduction video](https://www.youtube.com/watch?v=J2Z28CwIfsA) as Rails through YouTube's privacy-enhanced host. To use a different video file, set `VITE_WELCOME_VIDEO_URL` and optionally `VITE_WELCOME_VIDEO_POSTER_URL` when building the client.

## Work on a page in isolation

The [route-to-story map](storybook.md#route-to-story-map) links Hub pages to representative examples. Run the app for cross-page navigation or persisted changes. Use focused request and route tests to verify API responses, URL state, and behavior after a session or permission change.

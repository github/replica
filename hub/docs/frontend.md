# Routed frontend

The Hub frontend uses React Router Framework Mode as a single-page application (SPA) rendered in the browser. In mock mode, it connects the retained pages to local product mocks. In real mode, the repository index, prototype details, administrator roster, and Hub-wide security audit use their production APIs. Creation and branching open the original Copilot app handoff.

This frontend does not restore the production Hub. Configured GitHub authentication, Hub admission, browser sessions, a repository index, and a prototype detail API are available; see [Authentication](authentication.md). The following remain separate backend work:

- Other product APIs and repository-specific permissions.
- External product integrations.
- Build hosting and publishing.

Browser source lives under [client/](../client/), with its routed entry in [application/hub/](../client/application/hub/). The [frontend layers](coding-conventions.md#frontend-layers) define how that entry uses presentation code. The Express API stays separate under [server/](../server/).

## Start with mock data

From `hub/`, with dependencies installed:

```sh
npm run dev:mock
```

Open <http://127.0.0.1:5173/repositories/2001>. No API server, database, GitHub App, or credentials are needed. Use the bottom-right **Test data** toolbar to:

- Open connected pages.
- Select a persona or reset records.
- Select slow, empty, forbidden, server-error, invalid-response, or save-error responses.

If port 5173 is occupied, leave that server running and use `npm run dev:mock -- --port 0`. Open the URL printed by the CLI; the operating system assigns a free port.

The dataset includes `octocat`, `mona`, additional fictional collaborators, `github/prototype`, and `github/empty`. Every page reads the same in-memory records. A successful details edit changes metadata, not build contents. A full reload or **Reset data** creates fresh records. Closing the tab discards the records; only the selected persona and API scenario are retained in tab-local session storage. Reset never changes a real Hub.

**Persona** selects an owner, a limited user, an administrator, or a signed-out state. Owner and administrator use Octocat; the limited profile uses Mona. Any signed-in persona can edit visible prototype details. Other mock capabilities remain separate. Signing in requires no credentials. Selecting another persona reloads the document and resets the complete world, including edits and drafts. Application requests carry no mock persona or revision headers.

In mock mode, the neutral root reads the simulated session. Private pages load their workspace in a separate layout; public shared previews and signed-out pages do not load a private workspace. These provisional product contracts are not adapters for real authentication or authorization.

In real mode, signed-out visitors see the authentication shell without loading provisional session or workspace data. Signed-in members open the first repository or an empty workspace. Administrators can open `/settings/administrators`, `/settings/sessions`, `/settings/copilot`, and `/settings/audit?scope=hub` without loading provisional product workspace data. The sessions page reads current Hub authentication counts, requires explicit confirmation, leaves for fresh authorization through the current session provider, and keeps the signed-out completion result visible after the API ends every Hub session. Sign-in, enrollment, and sign-out forms submit natively to the configured API. Members can search the index, filter it by user, page through 24 prototypes at a time, and open prototype details. The detail API selects the latest successful Build by default; `build` pins another successful Build, and invalid or unavailable selections return 404. A member can edit the name, description, and start page of any visible prototype; saving a draft registers it. Later edits preserve its author and registration time. Build history and sharing links remain unavailable in real mode. Users from other providers are shown by name or login without a GitHub link. Build user metadata may be unknown for older records. Hosted previews and live review remain unavailable, and other real product routes retain explicit API failures. In mock mode, `/` keeps the product entry flow, and `/admin-enrollment` redirects to the mock `/settings/enroll` flow. See [Hub development](development.md) for seed data and access limitations.

The Build pickers on the prototype and History views list successful, failed, and running Builds with their status. The mock Build history lists all Builds. On these views, successful Builds open the prototype view with `?build=N`; failed and running Builds are plain text because Hub does not store workflow run URLs. The separate share-link picker offers only successful Builds with a preview and keeps selections on the share-links page.

Product screens retain product-facing copy from the retained pages and their original fixtures. They do not describe mock data, simulations, or synthetic accounts. The bottom-right test toolbar is the only orange development surface and the only place for mock-only warnings, request diagnostics, and explanations of local actions. It can be collapsed on any viewport. Normal product validation, access-denied, and failure feedback remain in the product UI.

Collections use the retained Hub's normal sizes: 24 prototypes, 25 Builds, 20 author results, 50 inbox items, and 50 audit records per page. The default repository has 57 prototypes and Welcome has 57 Builds, including partial last pages. Inbox and activity fixtures also span multiple pages; `github/empty` and the empty-response scenario remain available.

Local preview HTML and representative SVG images are synthetic assets, not published builds or captured build evidence. They are served only by the mock development server.

## Routes and state

Start the mock development server before opening these examples. The links use the default port, `5173`; replace it with the port printed by the CLI if you start the server on another port. The [retained-page inventory](#retained-page-inventory) includes example links for every connected page.

| Route | Connected presentation | URL state | Open an example |
| --- | --- | --- | --- |
| `/` | Redirects to a repository or mock sign-in, or shows an empty workspace | Selection comes from session and workspace responses | [Home](http://127.0.0.1:5173/) |
| `/repositories` | Selects the first accessible repository, or shows an empty workspace | Uses the same selection behavior as Home; no separate repository-list screen | [Repositories](http://127.0.0.1:5173/repositories) |
| `/sign-in` | Mock sign-in using the retained home page | Already signed-in viewers return to their workspace | [Sign-in](http://127.0.0.1:5173/sign-in) |
| `/session` | Sign-in/out action; POST only, not a page | `intent` selects sign-in or sign-out | [Sign-in form](http://127.0.0.1:5173/sign-in); persona changes use the separate test toolbar |
| `/settings/administrators` | Real administrator roster, candidate search, and bounded opaque-cursor pagination | `before` is the server cursor; `result` carries completion feedback | Requires a configured real-mode administrator session |
| `/settings/administrators/:membershipId/revoke` | Explicit confirmation before provider authorization | Membership IDs are UUIDs; `before` retains the authoritative list page | Requires a configured real-mode administrator session |
| `/settings/administrators/confirm` | Continue or cancel the provider-verified role change | `authorizationId` is the server authorization UUID | Provider callback destination |
| `/settings/audit?scope=hub` | Real Hub-wide administrator security records; mock mode retains Hub and repository fixtures | `before` is the opaque server cursor; real mode accepts only Hub scope | Requires a configured real-mode administrator session |
| `/repositories/:repositoryId` | Repository prototypes | `q`, `author`, `page`, `view` | [github/prototype](http://127.0.0.1:5173/repositories/2001) |
| `/repositories/:repositoryId/prototypes/:prototypeId` | Preview, metadata, and review conversations | `build` pins the preview; `comment` opens a conversation | [Welcome review](http://127.0.0.1:5173/repositories/2001/prototypes/1?build=3&comment=1) |
| `/repositories/:repositoryId/prototypes/:prototypeId/builds` | Build history; successful Builds open in the prototype view | `page` | [Welcome build history](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds) |
| Other paths | Explicit not-found feedback | No success-shaped placeholder | [Not-found page (intentional 404)](http://127.0.0.1:5173/not-connected) |

Other seeded page states:

- Repositories: [list view](http://127.0.0.1:5173/repositories/2001?view=list) and [empty github/empty repository](http://127.0.0.1:5173/repositories/2002).
- Prototypes: [Welcome pinned to Build 1](http://127.0.0.1:5173/repositories/2001/prototypes/1?build=1), [Navigation with a running build](http://127.0.0.1:5173/repositories/2001/prototypes/2), and [Settings without builds](http://127.0.0.1:5173/repositories/2001/prototypes/3).
- Build history: [older Welcome builds](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds?page=2) and [empty Settings history](http://127.0.0.1:5173/repositories/2001/prototypes/3/builds).
- Templates: [default starter](http://127.0.0.1:5173/repositories/2001/templates/default) and [Welcome template](http://127.0.0.1:5173/repositories/2001/templates/prototype-1).
- Shared previews: [active link](http://127.0.0.1:5173/shared/demo-active), [expired link](http://127.0.0.1:5173/shared/demo-expired), and [revoked link](http://127.0.0.1:5173/shared/demo-revoked).

`author=me` selects the signed-in viewer; other user selections use an ID returned by the authors endpoint. Search, author, pagination, and gallery/list changes are reflected in the URL. Draft text and pending form state remain local to the interaction.

Review search and participant filters use `commentSearch` and `commentParticipant` in the URL. The following flags are enabled by a value of `1`:

- `commentBuild`
- `commentPage`
- `commentResolved`
- `commentUnread`
- `commentMine`

Closing a conversation removes `comment`; browser back/forward restores the selection and filters.

Repository pages, Hub settings and Public sharing use one [workspace navigation definition](../client/application/hub/view-models/workspace-navigation/index.ts) for labels, ordering, destinations and visibility. Repository navigation adds its repository-specific links without redefining Hub settings. Current settings permissions, hidden Welcome state and unread counts replace cached workspace values before navigation is assembled.

In mock mode, every workspace page shows administrators these links in order:

- Hub administrators
- Public sharing
- End all Hub sessions
- GitHub App
- Copilot connection
- Security audit

Other users do not see administrator links. Security audit links select Hub scope for administrators and repository scope for other users with repository context. A user without either context has no audit link.

Links to Hub-wide pages carry `repositoryId` to preserve the selected repository; direct Public sharing visits use the first available repository. Users without repository access retain global navigation without an empty selector. Public and signed-out layouts remain separate.

Analytics and Learnings belong to `/repositories/:repositoryId/analytics` and `/repositories/:repositoryId/learnings`. Their path identifier selects the repository for reads and form submissions, even if a query parameter names another repository. Malformed path identifiers return 400; unavailable repositories return 404. Hub-wide Public sharing uses `/settings/sharing`. Security audit keeps its existing `/settings/audit?scope=hub` and `/settings/audit?scope=repository&repositoryId=...` URLs.

Old `/settings/analytics` and `/settings/learnings` links redirect to the selected repository's canonical page, retaining other query parameters. Without `repositoryId`, they select the first accessible repository; invalid or unavailable explicit context remains an error. `/admin/sharing` redirects to `/settings/sharing`, preserving its query parameters.

Application code adapts internal links and same-origin GET forms to SPA navigation while preserving modified clicks, external links, downloads, and new tabs. Explicit adapters handle the connected mutations and sign-out. Unknown non-GET forms are blocked and reported through the test toolbar rather than submitting to removed server actions.

### Loading and notifications

Pending page navigation shows a thin green pulse moving to the right, with a screen-reader loading announcement and a static bar for reduced-motion preferences. Loading feedback does not move page content.

Routine notices and successful form results appear as dismissible toasts stacked in the bottom-right corner. They do not take focus, expire on a timer, or occupy space in the page layout. Dismissing a toast hides that message until it changes or its owning page or result remounts. Validation failures, access restrictions, action choices and consequential warnings remain inline beside the affected content.

### Rails conversion route map

Use this map to find the frontend destination when converting a Rails page. The Rails reference is [the route file at commit `0e8bdbd9`](https://github.com/github/replica/blob/0e8bdbd952ce0d93c8976876fa59e9f119614ae8/hub/config/routes.rb). Current routes are registered in the [root route configuration](../client/application/hub/routes.ts), [product routes](../client/application/hub/routes/product-routes.ts), and [settings routes](../client/application/hub/routes/settings-routes.ts). Update this map when a canonical page URL changes.

`:repo` stands for the repository ID; actual parameter names differ between frameworks. Optional `repositoryId` query parameters that only preserve sidebar context are omitted. This is a page-URL map, not an API or mutation-endpoint inventory, a promise of identifier compatibility, or evidence of backend feature parity.

| Page | Rails | React Router |
| --- | --- | --- |
| Home | `/` | `/` |
| Sign-in | Home with authentication actions | `/sign-in` |
| Welcome | `/welcome` | `/welcome` |
| Repositories | `/repositories` | `/repositories` |
| Prototypes | `/repositories/:repo` | `/repositories/:repo` |
| Create prototype | `/repositories/:repo/new` | `/repositories/:repo/new` |
| Manage prototypes | `/repositories/:repo/prototypes/manage` | `/repositories/:repo/prototypes/manage` |
| Prototype | `/repositories/:repo/prototypes/:prototypeId` | `/repositories/:repo/prototypes/:prototypeId` |
| Build history | `/repositories/:repo/prototypes/:prototypeId/builds` | `/repositories/:repo/prototypes/:prototypeId/builds` |
| Specific Build | `/repositories/:repo/prototypes/:prototypeId/builds/:id` | Not ported; select a successful Build with `/repositories/:repo/prototypes/:prototypeId?build=:number` |
| Prototype share links | `/repositories/:repo/prototypes/:prototypeId/share_links` | `/repositories/:repo/prototypes/:prototypeId/share-links` |
| Browse template | `/repositories/:repo/templates/:templateId` | `/repositories/:repo/templates/:templateId` |
| Analytics | `/repositories/:repo/analytics` | `/repositories/:repo/analytics` |
| Learnings | `/repositories/:repo/learnings` | `/repositories/:repo/learnings` |
| Notifications | `/notifications` | `/notifications` |
| Public shared Build | `/share/:public_id` | `/shared/:shareId` |
| Hub administrators | `/hub_admins` | `/settings/administrators` |
| Public sharing | `/sharing_settings` | `/settings/sharing` |
| End all Hub sessions | `/session_revocation` | `/settings/sessions` |
| Copilot connection | `/copilot` | `/settings/copilot` |
| Repository security audit | `/repositories/:repo/security_audit` | `/settings/audit?scope=repository&repositoryId=:repo` |
| Hub security audit | `/security_audit` | `/settings/audit?scope=hub` |
| Canvas connections | `/canvas/connections` | `/settings/canvas` |
| Canvas pairing approval | `/canvas/pair/:user_code` | `/settings/canvas/approve` |
| Administrator enrollment | `/operator/enrollment` | `/settings/enroll` |
| Fresh authorization | `/authorization/:id` | `/settings/authorize` |
| GitHub App | `/github_app` | `/settings/github` |
| GitHub App setup | `/setup` | `/settings/github/setup` |
| Manual GitHub App setup | `/setup/manual` | `/settings/github/register` |
| Setup callback / installation | `/setup/callback`, `/setup/install` | `/settings/github/installed` |

The React `/repositories` entry selects the first accessible repository or shows the empty state; it is not a separate repository-list screen. Build record IDs and Build numbers are different identifiers. The setup and installation mapping represents a consolidated frontend flow, not a replacement for the Rails provider callback protocol.

Compatibility redirects cover earlier React URLs, not every Rails URL:

| Previous React URL | Canonical destination |
| --- | --- |
| `/settings/analytics?repositoryId=:repo` | `/repositories/:repo/analytics` |
| `/settings/learnings?repositoryId=:repo` | `/repositories/:repo/learnings` |
| `/admin/sharing` | `/settings/sharing` |
| `/settings/admins` | `/settings/administrators` |

These redirects retain other query parameters. The repository-settings redirects remove `repositoryId` after moving it into the path; without it, they select the first accessible repository. Explicit invalid or unavailable repository context remains an error.

## Connected mock flows

- **Create:** write a brief or start from a template, then open the original continuation dialog. Only its explicit **Open Copilot App** link launches the app; submitting the brief does not create a mock prototype or Build or send a creation request to Hub. Closing the dialog retains the brief. Readers cannot submit a creation handoff.
- **Preview and branch:** the first visit opens the prototype information dialog; dismissing it is retained during the mock session. Minimized preview URLs remain valid when reloaded or reopened; their view state is separate from gallery/list filters. **Branch from here** opens the retained composer for users who can create prototypes. Its Copilot prompt names the source branch and includes the live preview route when available. It does not change the pinned Build or create a local record. Prototypes without a Build can still be branching starting points.
- **Controls:** a successful preview exposes the original Controls button and in-preview toolbar, including for readers. Failed, running and absent previews do not show Controls. The mock preview supplies an isolated Controls fixture so changes such as **Show description** and **Card spacing** affect the rendered preview without implementing hosted Builds.
- **Manage:** the gear beside the Prototypes heading opens the existing management route for users who can create prototypes. Gallery metadata, start-page metadata and fixture-branch registration change canonical local records, not GitHub, source code, workflows, or immutable Build contents.
- **Review:** the existing preview bridge supports element and area selection. All conversation changes share one mock review store. Ordinary failed saves retain the draft for retry. Denied or unavailable review writes refresh access; loaded comments are removed if the refresh reports access loss. The read-only profile can inspect conversations but cannot change them. This is not a live multi-user review service.
- **Share:** create and revoke local links pinned to successful Builds. `demo-active`, `demo-expired`, and `demo-revoked` exercise public states. New links open in the same tab because another document receives a fresh mock store. Disabling mock sharing revokes existing local links; re-enabling permits new links. This is provisional demo behavior, not an accepted production sharing policy.
- **Account and setup:** inspect normal sign-in/out, welcome, connection, GitHub App setup, confirmation, enrollment, and session screens with canned API state. Do not enter real credentials or secrets. No provider authorization, installation, key rotation, or real session revocation occurs.
- **Administration and activity:** the retained `/settings/admins` mock flow still records administrator mutation attempts as 501 responses without changing fixture roles. Real mode redirects that list path to `/settings/administrators`, where the retained pages use the implemented administrator APIs and provider authorization continuation. Real `/settings/audit?scope=hub` reads the implemented Hub-wide audit API; repository audit remains a mock fixture. Notifications, activity filters, analytics destinations, and learning actions retain their local mock behavior. A learning request returns a completed fixture run and suggestion rather than implementing a background-job simulator. No audit export, retention or deletion control, real telemetry export, model run, or background job is performed.

Use the administrator mock profile for administrative mutation states. Other profiles demonstrate the existing read-only and access-denied presentation. Profile changes and error scenarios are test controls, not security boundaries.

## Request boundary

Route modules export `clientLoader`, `clientAction`, and their default component. Framework Mode passes loader results as typed props; presentation pages do not import the router or make API requests.

The shared JSON client awaits mock startup before sending any API request. It forwards cancellation, checks HTTP status, parses JSON, and validates the result with Zod. API, JSON, schema, and startup failures remain errors. Expected details-save failures appear in the still-open editor with its draft intact.

Unsupported actions show a visible failure without requiring development controls. Credential and file submissions remain unprocessed; their technical diagnostics stay in the test toolbar.

These are frontend/mock contracts under [the application contracts](../client/application/hub/contracts/index.ts), not Prisma models or already-implemented Express endpoints. Repository and prototype identifiers are strings that accept UUIDs or positive whole numbers, so the server can issue UUIDs while mocks keep their numeric values. Template and share identifiers accept URL-safe opaque values rather than requiring the mock generator's format. Build commits accept full SHA-1 or SHA-256 object names. Coordinate real identifiers and contracts with backend work.

| HTTP interface | Result |
| --- | --- |
| `GET`, `POST`, `DELETE /api/session` | Viewer and capabilities; no mock profile or revision metadata |
| `GET /api/workspace` | Viewer and repository navigation |
| `GET /api/repositories/:repositoryId` | Filtered, paginated prototypes and repository authors |
| `GET /api/repositories/:repositoryId/authors` | Searchable user choices with a cursor |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId` | Prototype, Build records, and selected successful Build; real mode does not include hosted preview URLs |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId/builds` | Paginated build history |
| `PATCH /api/repositories/:repositoryId/prototypes/:prototypeId` | Mock: update a prototype's name and description (both required), and optional start page |
| `/api/repositories/:repositoryId/prototypes/:prototypeId/review-comments` and its comment actions | Review collections, changes, reactions, and read positions |
| `GET /api/repositories/:repositoryId/templates` and `/api/repositories/:repositoryId/templates/:templateId` | Template browsing |
| `GET /api/repositories/:repositoryId/prototype-management`, `PATCH /api/repositories/:repositoryId/prototype-management/:prototypeId` | Management records and metadata changes |
| `POST /api/repositories/:repositoryId/prototype-candidates/:candidateId` | Synthetic branch registration |
| `GET /api/repositories/:repositoryId/learnings` | Repository-authorized suggestions, exact evidence, accepted guidance, recall preview, recent runs, Copilot state, and usage |
| `POST /api/repositories/:repositoryId/learnings/runs` | Request one repository learning run |
| `POST /api/repositories/:repositoryId/learnings/:learningId/decision` | Accept, reject, or retire against the suggestion digest the administrator reviewed |
| `/api/repositories/:repositoryId/prototypes/:prototypeId/share-links` | Build-pinned local links and revocation |
| `GET /api/shared/:shareId` | Public preview or an explicit inactive-link state |
| `GET`, `PATCH /api/product/sharing-settings` | Local sharing state |
| `GET /api/settings/workspace`, `/api/settings/public`, `/api/settings/admin-candidates` | Settings records and synthetic page capabilities |
| `POST /api/settings/actions` | Explicitly named local actions; administrator role changes return 501 without changing state |

In real mode, Express implements `GET /api/workspace`, `GET /api/repositories/:repositoryId`, its `authors` endpoint, `GET /api/repositories/:repositoryId/prototypes/:prototypeId`, and the [prototype metadata](#prototype-metadata-edits) `PATCH` endpoint. The workspace lists the viewer and non-removed repositories. The repository index returns 24 eligible prototypes per page. It accepts `q`, `author`, and `page`, and rejects malformed values. Search ignores letter case and matches the prototype name, description, branch, and author login or name. A page past the end shows the last page. Each prototype includes its current Build or, when unset, the chronologically latest Build. The detail endpoint also includes unregistered prototypes and branches that were deleted, but excludes the default branch, replicas, and the reserved installation branch. It chooses the latest successful Build or a requested successful Build number; invalid and unavailable selections return 404. Unknown Build metadata remains null. Preview URLs and screenshots remain null because Hub does not host Builds yet. The authors endpoint lists other users with eligible prototypes, 20 at a time, sorted by login. Its cursor only marks where the last page ended. The [authentication guide](authentication.md) owns the real session routes.

### Prototype metadata edits

Unlike the mock contract above, the real endpoint accepts a strict JSON object with at least one of `name`, `description`, and `startPage`. For example, `{"description":"New overview"}` changes only the description. Any signed-in member can edit a visible prototype. The first edit registers a draft and makes that member its first author, using its valid existing name or branch name when `name` is omitted. Later edits preserve its author and registration time, even when concurrent edits race.

Hub checks the configured origin before parsing the bounded body and trims surrounding Unicode whitespace. Names must be nonblank and at most 255 Unicode code points. Descriptions may be null or blank, which clears them, and contain at most 500 code points. Both reject NUL and unpaired surrogates. A start page may be null or blank to clear it; detail reads return `/` when it is missing or blank. Omitted fields retain their stored values. Other start pages are local paths of at most 2,048 UTF-8 bytes, including any query or fragment. Hub adds a leading slash when needed and rejects external URLs, traversal, controls, backslashes, malformed escapes, reserved `/__replica` paths, and `.replica-internal` path segments, including encoded forms. Encoded spaces and encoded percent signs remain valid.

Invalid input returns 400, a wrong origin returns 403, and a missing or expired session returns 401. The default branch, replicas, the reserved installation branch, removed repositories, and prototypes requested under another repository return 404. A failed operation leaves the draft unchanged. A successful response includes the updated detail while preserving the prototype ID and Build relationships. Successful detail reads and edits report `canEdit: true` after session and visibility checks. Hub holds session authority and prototype visibility locked through the update and detail read-back.

The editor sends all three fields, shows saved values when reopened, and retains entered values after a failed save. Editing details does not enable sharing or prototype management.

Real administrator management does not use the provisional settings contracts:

| HTTP interface | Result |
| --- | --- |
| `GET /api/auth/session` | Current role, membership UUID, user UUID, provider, login, and name |
| `GET /api/administrators?limit=&before=` | Effective administrators and the next opaque cursor; provider presentation may be unavailable, so the membership UUID remains the stable identity |
| `GET /api/administrators/candidates?query=&limit=` | Existing active non-administrator memberships matched by provider login or name, with provider and membership identity shown before selection |
| `POST /api/administrators/authorizations/start` | Provider URL, authorization UUID and expiry bound to the exact operation and one to 50 membership UUIDs |
| `GET /api/administrators/authorizations/:id` | Verified unconsumed operation and server-owned targets shown before callback continuation |
| `POST /api/administrators/authorizations/continue` | Exact JSON continuation; reason codes become visible recovery guidance for stale and conflicting role changes |
| `POST /api/administrators/authorizations/cancel` | Cancel the server-owned authorization without changing roles |

Errors use an HTTP status and `{ "error": "..." }`. Request schemas and the same response schemas check the JSON fixtures and HTTP boundary. Server-side input validation and authorization remain separate backend responsibilities.

The [product contracts](../client/application/hub/product-contracts/index.ts), [Learnings contracts](../client/application/hub/learnings-contracts/index.ts), [settings contracts](../client/application/hub/settings-contracts/index.ts), and [session contracts](../client/application/hub/session-contracts/index.ts) define those provisional records. The review adapter injects this request boundary into the retained review hooks without changing their default consumers. Persona selection, scenarios, diagnostics, fixture generation, and local mutation rules belong to the mock runtime, not these contracts.

The Learnings backend still needs all three listed endpoints. Its read response must make repository authorization authoritative, return access denial without suggestion or evidence data, distinguish Hub-wide Copilot connection state from repository decision permission, and return exact review digests, replacement targets, evidence and contradiction counts, accepted-learning integrity states, recall text, recent run results, and decimal AI-credit usage. Decision writes must reject a stale digest and validate decision-specific fields. Run and decision writes must reread repository-administrator authority and return visible `403`, `409`, or `422` errors rather than success-shaped empty data. The local handlers keep only tab-lifetime development state and do not provide persistence, jobs, repository discovery, review import, or Copilot execution.

## Removing mocks

The [mock folder](../client/application/hub/mocks/) contains the development runtime and its test toolbar. The application starts it through the [bootstrap hook](../client/application/hub/bootstrap-hub-api/index.ts) and displays the toolbar through [DevelopmentTools](../client/application/hub/development-tools/index.tsx). Vite enables its asset plugin only in mock mode.

When the backend is ready:

- Remove the mock folder and its two application hooks.
- Remove the Vite mock-plugin import and registration, and the `dev:mock` script.
- Replace mock-backed test fixtures with the ported API's test support. Remove tests that only exercise discarded fake workflows.
- Remove MSW when no remaining tests need it.
- Keep the route and presentation code. Align its provisional contracts with the real API instead of treating fixture-shaped records as production contracts.
- Remove the [scenario URL propagation](../client/application/hub/view-models/resource-path/) and [same-tab sharing override](../client/application/hub/view-models/product-share-links-data/).

Product credential and file submissions remain unavailable until real handlers support them. Configured authentication forms are separate native submissions. A real API failure must never reactivate mock responses.

There is no shared query cache or automatic retry loop. Requests use `cache: "no-store"`; React Router owns route data and action revalidation. Manual retries revalidate the route. TanStack Query can be added later if shared caching, deduplication, or background refresh warrants it without switching routers.

## Real mode and builds

```sh
npm run dev:api
npm run dev
```

Run those in separate terminals. `npm run dev:api` uses local developer sign-in; use `npm run dev:api:live` for configured GitHub or Entra sign-in. [Development](development.md#start-with-the-real-api) explains the choice. Real mode proxies `/api` to Express and never starts MSW or falls back to fixtures. Open `/` for sign-in, or `/admin-enrollment` for administrator enrollment. After restoring an administrator session, open `/settings/administrators` for administrator management or `/settings/audit?scope=hub` for Hub-wide security records. Express exposes health, readiness, authentication, administrator-management, security-audit, workspace, repository-index, author-search, and prototype-detail routes, including prototype-detail edits. The real detail page does not show an editor and has no hosted preview yet. Other product routes show explicit API failures until their real endpoints exist.

The [authentication guide](authentication.md) owns real sign-in, admission, and session behavior. Those routes and the backend's [telemetry](telemetry.md) and [WebSocket](websockets.md) foundations do not change the provisional mock product contracts. WebSocket upgrades are denied until application access checks are supplied. Mock sign-in and review actions remain local simulations.

`npm run lint` and `npm run typecheck` generate Framework route types before their typed checks, including independent CI jobs. `npm run build` produces the static SPA under `dist/client/` and the separate API under `dist/server/`. Framework SPA Mode disables runtime SSR but still renders the root fallback at build time, so imported modules and the root remain safe outside a browser.

The worker and local preview assets are development-only and are not written into the production frontend. A deployment host needs SPA fallback for page URLs while routing `/api` separately; unknown API routes still return JSON 404 responses, not the SPA HTML.

Vite bundles Primer's CommonJS entries for the framework's development and build-time rendering. Storybook uses its own Vite configuration so the Framework plugin does not take over its renderer. The separate Controls and prototype canvas entry points keep their existing source paths and build configuration.

The `/` and `/repositories` entry points send signed-out viewers to sign-in and viewers with repositories to their first repository. When no repositories are available, the empty page keeps account access and permitted Hub navigation without inventing repository context.

## Retained-page inventory

The migration started from commit `3254a642c9bb2dbf635915892475fa37d7bf2f00`. Its Hub entry point rendered only the logo. The retained page tests, stories, and typed props provide presentation and interaction references, not proof that the removed backend destinations work.

All page modules below have a mock route. This demonstrates frontend navigation and local behavior, not backend feature parity or evidence that every retained design shipped previously.

Examples use seeded identifiers. A new tab starts with the Owner persona; use **Persona** and **Open page** in the test toolbar to explore other states. Changing personas reloads and resets the data. Choose the signed-out persona for sign-in and the administrator persona for administrative actions.

GitHub App setup, registration, and installation pages can be opened directly without reproducing a provider protocol first. The default fixture has an installed GitHub App and a connected Copilot service, so their normal settings are available to the administrator persona. Fresh authorization uses a pending continuation from a connection change or enrollment action.

| Page module | Intent and current connection | Open an example |
| --- | --- | --- |
| [Repositories index](../client/pages/repositories-index-page/) | Repository-free navigation at `/` and `/repositories` | [Empty workspace in Storybook](http://localhost:6006/?path=/story/hub-pages-repositories--empty) |
| [Repositories show](../client/pages/repositories-show-page/) | Connected repository listing, filters, and pagination | [github/prototype](http://127.0.0.1:5173/repositories/2001) |
| [Prototypes show](../client/pages/prototypes-show-page/) | Preview, metadata, and mock review conversations | [Welcome review](http://127.0.0.1:5173/repositories/2001/prototypes/1?build=3&comment=1) |
| [Builds index](../client/pages/builds-index-page/) | Connected build history | [Welcome history](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds) |
| [Home](../client/pages/home-index-page/) | `/sign-in` | [Mock sign-in](http://127.0.0.1:5173/sign-in) |
| [Analytics](../client/pages/analytics-page/) | `/repositories/:repositoryId/analytics` | [Repository analytics](http://127.0.0.1:5173/repositories/2001/analytics) |
| [Canvas pairings](../client/pages/canvas-pairings-page/) | `/settings/canvas` and `/settings/canvas/approve` | [Connections](http://127.0.0.1:5173/settings/canvas?repositoryId=2001) and [approval](http://127.0.0.1:5173/settings/canvas/approve?repositoryId=2001) |
| [Copilot connection](../client/pages/copilot-connection-page/) | `/settings/copilot` | [Mock Copilot connection](http://127.0.0.1:5173/settings/copilot) |
| [Fresh authorization](../client/pages/fresh-authorization-page/) | Mock `/settings/authorize`; real `/settings/administrators/confirm?authorizationId=:uuid` | [Administrator continuation in Storybook](http://localhost:6006/?path=/story/hub-pages-security-fresh-authorization--continuing) |
| [GitHub App](../client/pages/github-app-page/) | `/settings/github` | [Mock App settings](http://127.0.0.1:5173/settings/github) |
| [GitHub App install](../client/pages/github-app-setup-install-page/) | `/settings/github/installed` | [Installation after registration](http://127.0.0.1:5173/settings/github/installed) |
| [GitHub App register](../client/pages/github-app-setup-register-page/) | `/settings/github/register` | [Registration after setup](http://127.0.0.1:5173/settings/github/register) |
| [GitHub App setup](../client/pages/github-app-setup-show-page/) | `/settings/github/setup` | [Start mock App setup](http://127.0.0.1:5173/settings/github/setup) |
| [Admin confirmation](../client/pages/hub-admin-confirmation-page/) | Real `/settings/administrators/:membershipId/:operation`; mock retained route stays request-only | [Confirmation states in Storybook](http://localhost:6006/?path=/story/hub-pages-security-hub-administrator-confirmation--remove) |
| [Admin enrollment](../client/pages/hub-admin-enrollment-page/) | `/settings/enroll` | [Mock enrollment](http://127.0.0.1:5173/settings/enroll) |
| [Admins](../client/pages/hub-admins-page/) | Real `/settings/administrators`; mock `/settings/admins` | [Administrator roster in Storybook](http://localhost:6006/?path=/story/hub-pages-security-hub-administrators--multiple) |
| [Learnings](../client/pages/learnings-page/) | `/repositories/:repositoryId/learnings` | [Repository learnings](http://127.0.0.1:5173/repositories/2001/learnings) |
| [New prototype](../client/pages/new-prototype-page/) | `/repositories/:repositoryId/new` | [Create a prototype](http://127.0.0.1:5173/repositories/2001/new) |
| [Notifications](../client/pages/notifications-page/) | `/notifications` | [Notifications](http://127.0.0.1:5173/notifications) |
| [Prototype management](../client/pages/prototype-management-page/) | `/repositories/:repositoryId/prototypes/manage` | [Edit prototype listings](http://127.0.0.1:5173/repositories/2001/prototypes/manage) |
| [Replica browse](../client/pages/replica-browse-page/) | `/repositories/:repositoryId/templates/:templateId` | [Browse the default template](http://127.0.0.1:5173/repositories/2001/templates/default) |
| [Security audit](../client/pages/security-audit-page/) | Real Hub-wide read at `/settings/audit?scope=hub`; mock repository fixtures at `/settings/audit?scope=repository&repositoryId=:repositoryId` | [Mock repository activity](http://127.0.0.1:5173/settings/audit?scope=repository&repositoryId=2001) |
| [Session revocation](../client/pages/session-revocation-page/) | `/settings/sessions` | [Mock browser session](http://127.0.0.1:5173/settings/sessions) |
| [Share links](../client/pages/share-links-index-page/) | `/repositories/:repositoryId/prototypes/:prototypeId/share-links` | [Welcome share links](http://127.0.0.1:5173/repositories/2001/prototypes/1/share-links) |
| [Shared build](../client/pages/shared-builds-show-page/) | `/shared/:shareId` | [Active shared preview](http://127.0.0.1:5173/shared/demo-active) |
| [Sharing settings](../client/pages/sharing-settings-page/) | `/settings/sharing` | [Mock sharing controls](http://127.0.0.1:5173/settings/sharing) |
| [Welcome](../client/pages/welcome-page/) | `/welcome` | [Welcome page](http://127.0.0.1:5173/welcome) |

Settings collection filters use the URL. Repository-owned Analytics and Learnings use the path identifier. The real Hub-wide audit carries only `scope=hub` and the opaque `before` cursor; mock repository audit uses `repositoryId` to select fixture records. Use focused request/store/route tests for cross-page behavior and existing page tests for local interactions. Review visual changes in Storybook and capture affected stories following the [Storybook guide](storybook.md#ui-changes-and-pull-request-evidence). Do not freeze whole DOM trees, incidental copy, or provisional APIs as the migration's ground truth.

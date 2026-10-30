# Routed frontend

The Hub frontend uses React Router Framework Mode as a browser-rendered SPA. All 27 retained page modules are connected to local mock flows: repositories, prototypes, reviews, sharing, setup, account controls, administration, analytics, and learning. The application reuses those pages rather than implementing a second set of screens.

This is an evolving frontend implementation, not a restored production Hub. Real authentication, authorization, product APIs, persistence, external integrations, build hosting, and publishing remain separate work.

Browser source lives directly under [app/](../app/). The routed Hub entry is [application/hub/](../app/application/hub/); pages, features, components, hooks, utilities, Storybook fixtures, and theme tokens are sibling directories. The Express API stays separate under [server/](../server/).

## Start with mock data

From `hub/`, with dependencies installed:

```sh
npm run dev:mock
```

Open <http://127.0.0.1:5173/repositories/2001>. No API server, database, GitHub App, or credentials are needed. **Mock flow** opens the connected page groups. **Mock API scenario** selects slow, empty, forbidden, server-error, invalid-response, or save-error behavior.

If port 5173 is occupied, leave that server running and use `npm run dev:mock -- --port 0`. Open the URL printed by the CLI; the operating system assigns a free port.

The dataset uses `octocat`, `mona`, `github/prototype`, and `github/empty`. Every page reads the same in-memory records. A successful name or description edit is visible when navigating back to the repository; it changes metadata, not build contents. A full reload or **Reset mock data** creates a fresh store from the JSON fixture. Closing the tab discards its store. There is no browser-storage persistence, and reset never changes a real Hub.

**Mock user** selects an owner, a read-only user, an administrator, or a signed-out state. Owner and administrator use Octocat; the read-only profile uses Mona. These are fixture-defined UI capabilities, not production access policies. Signing in requires no credentials. Switching profiles removes the previous viewer's displayed data and drafts without resetting the shared synthetic records. Delayed writes are bound to their initiating mock session revision and are rejected if the viewer changes.

The neutral root reads the simulated session. Private pages load their workspace in a separate layout; public shared previews and signed-out pages do not load a private workspace. Replacing these contracts with real identity and authorization is outside this frontend work.

Mock-only UI and temporary integration notices have a 2px orange outline. Ordinary product UI does not get this outline just because it displays mock records. Mock controls occupy their own row on narrow screens so they do not cover page controls. On wider screens they float separately from the page.

Local preview HTML and representative SVG images are synthetic assets, not published builds or captured build evidence. They are served only by the mock development server.

## Routes and state

Start the mock development server before opening these examples. The links use the default port, `5173`; replace it with the port printed by the CLI if you start the server on another port. The inventory below lists the other connected pages.

| Route | Connected presentation | URL state | Open an example |
| --- | --- | --- | --- |
| `/` | Redirects to a repository or mock sign-in, or shows an empty workspace | Selection comes from session and workspace responses | [Home](http://127.0.0.1:5173/) |
| `/sign-in` | Mock sign-in using the retained home page | Already signed-in viewers return to their workspace | [Sign-in](http://127.0.0.1:5173/sign-in) |
| `/repositories/:repositoryId` | Repository prototypes | `q`, `author`, `page`, `view` | [github/prototype](http://127.0.0.1:5173/repositories/2001) |
| `/repositories/:repositoryId/prototypes/:prototypeId` | Preview, metadata, and review conversations | `build` pins the preview; `comment` opens a conversation | [Welcome review](http://127.0.0.1:5173/repositories/2001/prototypes/1?build=3&comment=1) |
| `/repositories/:repositoryId/prototypes/:prototypeId/builds` | Build history | `page` | [Welcome build history](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds) |
| `/repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber` | Build metadata and representative images | Build selection is in the path | [Successful Build 3](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds/3) |
| Other paths | Explicit not-found feedback | No success-shaped placeholder | [Not-found page (intentional 404)](http://127.0.0.1:5173/not-connected) |

Other seeded page states:

- Repositories: [list view](http://127.0.0.1:5173/repositories/2001?view=list) and [empty github/empty repository](http://127.0.0.1:5173/repositories/2002).
- Prototypes: [Welcome pinned to Build 1](http://127.0.0.1:5173/repositories/2001/prototypes/1?build=1), [Navigation with a running build](http://127.0.0.1:5173/repositories/2001/prototypes/2), and [Settings without builds](http://127.0.0.1:5173/repositories/2001/prototypes/3).
- Build history: [older Welcome builds](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds?page=2) and [empty Settings history](http://127.0.0.1:5173/repositories/2001/prototypes/3/builds).
- Build details: [failed Welcome Build 2](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds/2) and [running Navigation Build 1](http://127.0.0.1:5173/repositories/2001/prototypes/2/builds/1).

`author=me` selects the mock viewer; other author selections use an ID returned by the authors endpoint. Search, author, pagination, and gallery/list changes are reflected in the URL. Draft text and pending form state remain local to the interaction.

Review filters also live in the URL: `commentSearch`, `commentParticipant`, and the `commentBuild`, `commentPage`, `commentResolved`, `commentUnread`, and `commentMine` flags. A flag value of `1` enables it. Closing a conversation removes `comment`; browser back/forward restores the selection and filters.

Application code adapts internal links and same-origin GET forms to SPA navigation while preserving modified clicks, external links, downloads, and new tabs. Explicit adapters handle the connected mutations and mock sign-out. Unknown non-GET forms display a warning rather than submitting to removed server actions.

## Connected mock flows

- **Create and manage:** create a synthetic prototype and Build, start from a template, register a synthetic branch, or edit gallery metadata and start-page metadata. These actions change canonical local records, not GitHub, source code, workflows, or immutable Build contents.
- **Review:** the existing preview bridge supports element and area selection. Comments, replies, edits, deletion, resolution, reactions, and read positions share a mock review store. Failed saves retain the draft; recovery can retry it. The read-only profile can inspect conversations but cannot change them. This is not a live multi-user review service.
- **Share:** create and revoke local links pinned to successful Builds. `demo-active`, `demo-expired`, and `demo-revoked` exercise public states. New links open in the same tab because another document receives a fresh mock store. Disabling mock sharing revokes existing local links; re-enabling permits new links. This is provisional demo behavior, not an accepted production sharing policy.
- **Account and setup:** simulate sign-in/out, welcome dismissal, connection approval/revocation, GitHub App setup, confirmation, enrollment, and ending sessions. Do not enter real credentials or secrets. No provider authorization, installation, key rotation, or real session revocation occurs.
- **Administration and activity:** exercise synthetic administrator changes, notifications, activity filters, analytics destinations, and learning actions. No real telemetry export, durable security audit, model run, or background job is performed.

Use the administrator mock profile for administrative mutation states. Other profiles demonstrate the existing read-only and access-denied presentation. Profile changes and error scenarios are test controls, not security boundaries.

## Request boundary

Route modules export `clientLoader`, `clientAction`, and their default component. Framework Mode passes loader results as typed props; presentation pages do not import the router or make API requests.

The shared JSON client awaits mock startup before sending any API request. It forwards cancellation, checks HTTP status, parses JSON, and validates the result with Zod. API, JSON, schema, and startup failures remain errors. Expected details-save failures appear in the still-open editor with its draft intact.

These are frontend/mock contracts under [the application contracts](../app/application/hub/contracts/index.ts), not Prisma models or already-implemented Express endpoints. The mock identifiers preserve the retained presentation; coordinate real identifiers and contracts with backend work.

| HTTP interface | Result |
| --- | --- |
| `GET`, `POST`, `DELETE /api/session` | Simulated viewer, capabilities, and revision |
| `GET /api/workspace` | Viewer and repository navigation |
| `GET /api/repositories/:repositoryId` | Filtered, paginated prototypes and repository authors |
| `GET /api/repositories/:repositoryId/authors` | Searchable author choices with a cursor |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId` | Prototype, build options, and selected preview |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId/builds` | Paginated build history |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber` | Build details |
| `PATCH /api/repositories/:repositoryId/prototypes/:prototypeId` | Updated name/description and prototype data |
| `/api/repositories/:repositoryId/prototypes/:prototypeId/review-comments` and its comment actions | Review collections, changes, reactions, and read positions |
| `GET /api/repositories/:repositoryId/templates` and `/api/repositories/:repositoryId/templates/:templateId` | Template browsing |
| `POST /api/repositories/:repositoryId/prototypes` | Synthetic prototype and Build creation |
| `GET /api/repositories/:repositoryId/prototype-management`, `PATCH /api/repositories/:repositoryId/prototype-management/:prototypeId` | Management records and metadata changes |
| `POST /api/repositories/:repositoryId/prototype-candidates/:candidateId` | Synthetic branch registration |
| `/api/repositories/:repositoryId/prototypes/:prototypeId/share-links` | Build-pinned local links and revocation |
| `GET /api/shared/:shareId` | Public preview or an explicit inactive-link state |
| `GET`, `PATCH /api/product/sharing-settings` | Local sharing state |
| `GET /api/settings/workspace`, `/api/settings/public`, `/api/settings/admin-candidates` | Settings records and synthetic page capabilities |
| `POST /api/settings/actions` | Explicitly named local account, setup, administrative, analytics, and learning actions |

Errors use an HTTP status and `{ "error": "..." }`. Request schemas and the same response schemas check the JSON fixtures and HTTP boundary. Server-side input validation and authorization remain separate backend responsibilities.

The [product contracts](../app/application/hub/product-contracts/index.ts), [settings contracts](../app/application/hub/settings-contracts/index.ts), and [session contracts](../app/application/hub/session-contracts/index.ts) define those provisional records. The review adapter injects this request boundary into the retained review hooks without changing their default consumers. Mock handlers use the shared response helper and check the initiating session revision immediately before mutations, including after asynchronous body parsing.

There is no shared query cache or automatic retry loop. Requests use `cache: "no-store"`; React Router owns route data and action revalidation. Manual retries revalidate the route. TanStack Query can be added later if shared caching, deduplication, or background refresh warrants it without switching routers.

## Real mode and builds

```sh
npm run dev:api
npm run dev
```

Run those in separate terminals. Real mode proxies `/api` to Express and never starts MSW or falls back to fixtures. Express currently implements only the health endpoint, so product routes show explicit API failures until their real endpoints exist.

`npm run lint` and `npm run typecheck` generate Framework route types before their typed checks, including independent CI jobs. `npm run build` produces the static SPA under `dist/client/` and the separate API under `dist/server/`. Framework SPA Mode disables runtime SSR but still renders the root fallback at build time, so imported modules and the root remain safe outside a browser.

The worker and local preview assets are development-only and are not written into the production frontend. A deployment host needs SPA fallback for page URLs while routing `/api` separately; unknown API routes still return JSON 404 responses, not the SPA HTML.

Vite bundles Primer's CommonJS entries for the framework's development and build-time rendering. Storybook uses its own Vite configuration so the Framework plugin does not take over its renderer. The separate Controls and prototype canvas entry points keep their existing source paths and build configuration.

## Retained-page inventory

The migration started from commit `3254a642c9bb2dbf635915892475fa37d7bf2f00`. Its Hub entry point rendered only the logo. The retained page tests, stories, and typed props provide presentation and interaction references, not proof that the removed backend destinations work.

All page modules below have a mock route. This demonstrates frontend navigation and local behavior, not backend feature parity or evidence that every retained design shipped previously.

| Page module | Intent and current connection |
| --- | --- |
| [Repositories show](../app/pages/repositories-show-page/) | Connected repository listing, filters, and pagination |
| [Prototypes show](../app/pages/prototypes-show-page/) | Preview, metadata, and mock review conversations |
| [Builds index](../app/pages/builds-index-page/) | Connected build history |
| [Builds show](../app/pages/builds-show-page/) | Connected build details |
| [Home](../app/pages/home-index-page/) | `/sign-in` |
| [Analytics](../app/pages/analytics-page/) | `/settings/analytics` |
| [Canvas pairings](../app/pages/canvas-pairings-page/) | `/settings/canvas` and `/settings/canvas/approve` |
| [Copilot connection](../app/pages/copilot-connection-page/) | `/settings/copilot` |
| [Fresh authorization](../app/pages/fresh-authorization-page/) | `/settings/authorize` |
| [GitHub App](../app/pages/github-app-page/) | `/settings/github` |
| [GitHub App install](../app/pages/github-app-setup-install-page/) | `/settings/github/installed` |
| [GitHub App register](../app/pages/github-app-setup-register-page/) | `/settings/github/register` |
| [GitHub App setup](../app/pages/github-app-setup-show-page/) | `/settings/github/setup` |
| [Admin confirmation](../app/pages/hub-admin-confirmation-page/) | `/settings/admins/:userId/:operation` |
| [Admin enrollment](../app/pages/hub-admin-enrollment-page/) | `/settings/enroll` |
| [Admins](../app/pages/hub-admins-page/) | `/settings/admins` |
| [Learnings](../app/pages/learnings-page/) | `/settings/learnings` |
| [New prototype](../app/pages/new-prototype-page/) | `/repositories/:repositoryId/new` |
| [Notifications](../app/pages/notifications-page/) | `/notifications` |
| [Prototype management](../app/pages/prototype-management-page/) | `/repositories/:repositoryId/prototypes/manage` |
| [Replica browse](../app/pages/replica-browse-page/) | `/repositories/:repositoryId/templates/:templateId` |
| [Security audit](../app/pages/security-audit-page/) | `/settings/audit` |
| [Session revocation](../app/pages/session-revocation-page/) | `/settings/sessions` |
| [Share links](../app/pages/share-links-index-page/) | `/repositories/:repositoryId/prototypes/:prototypeId/share-links` |
| [Shared build](../app/pages/shared-builds-show-page/) | `/shared/:shareId` |
| [Sharing settings](../app/pages/sharing-settings-page/) | `/admin/sharing` |
| [Welcome](../app/pages/welcome-page/) | `/welcome` |

Settings collection filters use the URL, including `repositoryId` where a repository is selected. Use focused request/store/route tests for cross-page behavior and existing page tests for local interactions. Review visual changes in Storybook and capture affected stories following the [Storybook guide](storybook.md#ui-changes-and-pull-request-evidence). Do not freeze whole DOM trees, incidental copy, or provisional APIs as the migration's ground truth.

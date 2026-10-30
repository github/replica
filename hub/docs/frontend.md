# Routed frontend

The first connected Hub journey uses React Router Framework Mode as a browser-rendered SPA: repository, prototype preview, build history, and build details. It reuses the retained pages rather than implementing a second set of screens.

This is an evolving frontend implementation. The Express product APIs, production sign-in, real build hosting, and reviews are not implemented.

Browser source lives directly under [app/](../app/). The routed Hub entry is [application/hub/](../app/application/hub/); pages, features, components, hooks, utilities, Storybook fixtures, and theme tokens are sibling directories. The Express API stays separate under [server/](../server/).

## Start with mock data

From `hub/`, with dependencies installed:

```sh
npm run dev:mock
```

Open <http://127.0.0.1:5173/repositories/2001>. No API server, database, GitHub App, or credentials are needed. The mock controls identify the synthetic environment and select slow, empty, forbidden, server-error, invalid-response, or save-error scenarios. Empty scenarios apply to collections and prototype previews.

If port 5173 is occupied, leave that server running and use `npm run dev:mock -- --port 0`. Open the URL printed by the CLI; the operating system assigns a free port.

The dataset uses `octocat`, `mona`, `github/prototype`, and `github/empty`. Every page reads the same in-memory records. A successful name or description edit is visible when navigating back to the repository; it changes metadata, not build contents. A full reload or **Reset mock data** creates a fresh store from the JSON fixture. Closing the tab discards its store. There is no browser-storage persistence, and reset never changes a real Hub.

Mock controls occupy their own row on narrow screens so they do not cover page controls. On wider screens they float separately from the page.

Local preview HTML and representative SVG images are synthetic assets, not published builds or captured build evidence. They are served only by the mock development server.

## Routes and state

Start the mock development server before opening these examples. The links use the default port, `5173`; replace it with the port printed by the CLI if you start the server on another port. These examples cover every connected route. Retained-only pages in the inventory below do not have application routes yet.

| Route | Connected presentation | URL state | Open an example |
| --- | --- | --- | --- |
| `/` | Redirects to the first available repository, or shows an empty state | Repository selection comes from the workspace response | [Home](http://127.0.0.1:5173/) |
| `/repositories/:repositoryId` | Repository prototypes | `q`, `author`, `page`, `view` | [github/prototype](http://127.0.0.1:5173/repositories/2001) |
| `/repositories/:repositoryId/prototypes/:prototypeId` | Prototype preview and editable name/description | Optional `build` pins the preview | [Welcome](http://127.0.0.1:5173/repositories/2001/prototypes/1) |
| `/repositories/:repositoryId/prototypes/:prototypeId/builds` | Build history | `page` | [Welcome build history](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds) |
| `/repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber` | Build metadata and representative images | Build selection is in the path | [Successful Build 3](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds/3) |
| Other paths | Explicit not-found feedback | No success-shaped placeholder | [Not-found page (intentional 404)](http://127.0.0.1:5173/not-connected) |

Other seeded page states:

- Repositories: [list view](http://127.0.0.1:5173/repositories/2001?view=list) and [empty github/empty repository](http://127.0.0.1:5173/repositories/2002).
- Prototypes: [Welcome pinned to Build 1](http://127.0.0.1:5173/repositories/2001/prototypes/1?build=1), [Navigation with a running build](http://127.0.0.1:5173/repositories/2001/prototypes/2), and [Settings without builds](http://127.0.0.1:5173/repositories/2001/prototypes/3).
- Build history: [older Welcome builds](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds?page=2) and [empty Settings history](http://127.0.0.1:5173/repositories/2001/prototypes/3/builds).
- Build details: [failed Welcome Build 2](http://127.0.0.1:5173/repositories/2001/prototypes/1/builds/2) and [running Navigation Build 1](http://127.0.0.1:5173/repositories/2001/prototypes/2/builds/1).

`author=me` selects the mock viewer; other author selections use an ID returned by the authors endpoint. Search, author, pagination, and gallery/list changes are reflected in the URL. Draft text and pending form state remain local to the interaction.

Application code adapts the retained pages' internal links to SPA navigation while preserving modified clicks, external links, downloads, and new tabs. Unconnected non-GET forms, including the retained sign-out form, display a warning rather than submitting to removed server actions.

Prototype previews use the existing preview bridge with reviews disabled. The page explicitly says reviews are not connected; it does not fetch removed review APIs or pretend an empty review successfully loaded. Start-page editing, branching, publication, workflow installation, and other product mutations are outside this first journey.

## Request boundary

Route modules export `clientLoader`, `clientAction`, and their default component. Framework Mode passes loader results as typed props; presentation pages do not import the router or make API requests.

The shared JSON client awaits mock startup before sending any API request. It forwards cancellation, checks HTTP status, parses JSON, and validates the result with Zod. API, JSON, schema, and startup failures remain errors. Expected details-save failures appear in the still-open editor with its draft intact.

These are frontend/mock contracts under [the application contracts](../app/application/hub/contracts/index.ts), not Prisma models or already-implemented Express endpoints. The mock identifiers preserve the retained presentation; coordinate real identifiers and contracts with backend work.

| HTTP interface | Result |
| --- | --- |
| `GET /api/workspace` | Viewer and repository navigation |
| `GET /api/repositories/:repositoryId` | Filtered, paginated prototypes and repository authors |
| `GET /api/repositories/:repositoryId/authors` | Searchable author choices with a cursor |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId` | Prototype, build options, and selected preview |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId/builds` | Paginated build history |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber` | Build details |
| `PATCH /api/repositories/:repositoryId/prototypes/:prototypeId` | Updated name/description and prototype data |

Errors use an HTTP status and `{ "error": "..." }`. Request schemas and the same response schemas check the JSON fixtures and HTTP boundary. Server-side input validation and authorization remain separate backend responsibilities.

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

The four connected page modules below form the first journey. The other 23 top-level pages remain retained presentation. Source alone does not establish whether their behavior shipped previously or was proposed; confirm that ancestry and the API as each flow is connected.

| Page module | Intent and current connection |
| --- | --- |
| [Repositories show](../app/pages/repositories-show-page/) | Connected repository listing, filters, and pagination |
| [Prototypes show](../app/pages/prototypes-show-page/) | Connected local preview and name/description edit; reviews explicitly disconnected |
| [Builds index](../app/pages/builds-index-page/) | Connected build history |
| [Builds show](../app/pages/builds-show-page/) | Connected build details |
| [Home](../app/pages/home-index-page/) | Retained sign-in entry; `signInPath` POST is not connected |
| [Analytics](../app/pages/analytics-page/) | Retained destination/event configuration and POST actions |
| [Canvas pairings](../app/pages/canvas-pairings-page/) | Retained approve/revoke/cancel presentation |
| [Copilot connection](../app/pages/copilot-connection-page/) | Retained connect/disconnect forms |
| [Fresh authorization](../app/pages/fresh-authorization-page/) | Retained confirmation/cancellation forms |
| [GitHub App](../app/pages/github-app-page/) | Retained configuration/reset forms |
| [GitHub App install](../app/pages/github-app-setup-install-page/) | Retained installation guidance |
| [GitHub App register](../app/pages/github-app-setup-register-page/) | Retained registration form |
| [GitHub App setup](../app/pages/github-app-setup-show-page/) | Retained secret/organization setup form |
| [Admin confirmation](../app/pages/hub-admin-confirmation-page/) | Retained privileged-action confirmation |
| [Admin enrollment](../app/pages/hub-admin-enrollment-page/) | Retained enrollment form |
| [Admins](../app/pages/hub-admins-page/) | Retained administrator list and add/confirmation presentation |
| [Learnings](../app/pages/learnings-page/) | Retained run, edit, reject, and retire presentation |
| [New prototype](../app/pages/new-prototype-page/) | Retained client brief/template flow; submission API unconfirmed |
| [Notifications](../app/pages/notifications-page/) | Retained list/load-more presentation |
| [Prototype management](../app/pages/prototype-management-page/) | Retained management navigation |
| [Replica browse](../app/pages/replica-browse-page/) | Retained preview/branch orchestration; submission API unconfirmed |
| [Security audit](../app/pages/security-audit-page/) | Retained scope, pagination, and sign-out presentation |
| [Session revocation](../app/pages/session-revocation-page/) | Retained revoke/cancel/sign-in presentation |
| [Share links](../app/pages/share-links-index-page/) | Retained create/manage share-link presentation |
| [Shared build](../app/pages/shared-builds-show-page/) | Retained shared-preview presentation; no sharing service |
| [Sharing settings](../app/pages/sharing-settings-page/) | Retained settings form |
| [Welcome](../app/pages/welcome-page/) | Retained setup/guidance/dismiss presentation |

Use focused request/store/route tests for the connected journey and existing page tests for their local behavior. Review visual changes in Storybook and capture the affected stories following the [Storybook guide](storybook.md#ui-changes-and-pull-request-evidence). Do not freeze whole DOM trees, incidental copy, or speculative APIs as the migration's ground truth.

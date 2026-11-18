# Working on Replica Hub

Hub uses a TypeScript Express API, React Router with React and Vite, and PostgreSQL with Prisma. Read the [root instructions](../AGENTS.md), [shared guides](../docs/README.md), and [Hub documentation](docs/README.md) before editing. The [architecture guide](docs/architecture.md) describes current capabilities and remaining work; Build importing, hosted previews, and live multi-user updates are not available.

## Layout

- `client/` contains browser code. `client/application/hub/` owns routing and requests; pages, features, components, hooks, and utilities form the presentation layers.
- `server/` contains the API, domains, repositories, integrations, utilities, operational scripts, and workers.
- `schema/` contains the multi-file Prisma schema and migrations.
- `test/` contains shared Vitest setup and isolated database-test infrastructure; feature tests stay beside their code.
- `.devcontainer/` contains the development container and PostgreSQL Compose service. `docs/` owns the detailed contributor guides.

Keep shared canvas and Controls source under `client/`; the prototype extension and build action consume it independently of the Hub API. Update those consumers when source paths change.

## Install and run

Run the following commands from `hub/`, using a Node.js version supported by `engines.node` in [package.json](package.json). Use the npm proxy, not the public registry:

```sh
npm ci --engine-strict --registry=https://packagefeedproxy.microsoft.io/npm/
npm run dev:mock
```

Open <http://127.0.0.1:5173/repositories/2001> for the mock frontend; it needs no API, database, or credentials. Installation generates Prisma Client without connecting to PostgreSQL.

After installing Hub dependencies, use the [devcontainer](docs/development.md#devcontainer) for the real API or prepare local PostgreSQL and configuration. Copy `.env.example` only for first-time setup; preserve an existing `.env` and never commit credentials.

```sh
docker compose -f .devcontainer/compose.yaml up -d db
[ -e .env ] || cp .env.example .env
npm ci --prefix ../packages/learning --engine-strict --registry=https://packagefeedproxy.microsoft.io/npm/
npm run setup
npm run dev:api
```

Run `npm run setup` again after pulling migrations. In a second terminal, run `npm run dev` from `hub/` and open <http://127.0.0.1:5173>. Vite forwards `/api` to Express on port 3001.

`npm run dev:api` uses local developer sign-in and requires a local development database and loopback configuration. It refuses configured GitHub or Entra sign-in and repository connections; use `npm run dev:api:live` when testing those providers. Read [development](docs/development.md#start-with-the-real-api) before switching modes on an existing database because switching changes persisted provider state.

The API does not start background consumers. When needed, run `npm run worker:on-demand` and `npm run worker:scheduled` in separate terminals after setup. Follow [background jobs](docs/background-jobs.md) for their lifecycle. Stop Compose without `--volumes` to preserve local data.

## Check and build

[Testing and operations](docs/testing-and-operations.md) owns the complete check workflow. Hub CI runs these package scripts independently on both supported Node majors:

```sh
npm run lint
npm run db:validate
npm run typecheck
npm test
npm run test:database
npm run build
npm run storybook:build
```

`npm test` runs Node.js and jsdom tests without PostgreSQL. Use `npm test -- server/create-app/index.test.ts` for a focused case. Database tests use `.db.test.ts` or `.db.test.tsx`; start PostgreSQL and set `TEST_DATABASE_URL` as described in [parallel database tests](docs/testing-and-operations.md#parallel-database-tests). Use a local test user allowed to create and drop databases, never a production connection. The harness creates isolated worker databases and resets their records between cases.

`npm run build` checks types and writes `dist/client/` and `dist/server/`. `npm start` runs the compiled API; `npm run preview` serves the built frontend separately for local inspection. `npm run storybook` opens the presentation workbench on port 6006.

Shared Controls or canvas changes also need the [shared-code checks](docs/testing-and-operations.md#shared-code). `npm run image:check` needs a Docker-compatible daemon; the separate Hub image workflow runs that smoke check. The Hub infrastructure workflow covers Terraform and installer tooling, not the application unit suite.

For documentation-only changes, review prose and links rather than running application tests. From the repository root, run `hub/bin/review-prose` and `git diff --check`.

## Key conventions

- Follow [backend architecture](docs/backend-architecture.md) for allowed imports and [coding conventions](docs/coding-conventions.md) for TypeScript and frontend layers. Use kebab-case function directories with colocated tests; preserve explicit ESM file paths for native Node runtime imports.
- Keep HTTP parsing and responses outside domains. Agree on the design before adding product models, permissions, deployment choices, or product API routes.
- Follow [database conventions](docs/database.md) for Prisma models, migrations, and the shared client, and [authentication](docs/authentication.md) for identity and access boundaries.
- Keep `HubThemeProvider` around application and Storybook content so portals inherit Brand and `--hub-*` tokens. Do not fix overlays to the light theme.
- Keep product copy independent of mock data. Mock-only controls and diagnostics belong in the bottom-right test toolbar; [the frontend guide](docs/frontend.md) owns fixtures and resets.
- Follow [Storybook requirements](docs/storybook.md#ui-changes-and-pull-request-evidence) for visual changes and PR screenshots, and [telemetry](docs/telemetry.md) for explicit spans and safe attributes.
- Use the [root browser workflow](../AGENTS.md#browser-validation-and-playwright-fallback) and [browser validation workflow](../starter/.agents/skills/browser-canvas-validation/WORKFLOW.md) for rendered checks.

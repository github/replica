# Hub development

Use the Hub devcontainer for Node.js and its pinned PostgreSQL version, or run Node.js locally with PostgreSQL 17 or newer. Hub can expose GitHub, Microsoft Entra, or both sign-in choices and reusable administrator enrollment when the shared settings and at least one provider profile are configured. See [Deployment](deployment.md) for the production runtime.

## Frontend without a backend

Follow [Routed frontend](frontend.md) for local startup, data modes, and route examples. The local frontend can run without PostgreSQL or the API server.

## Devcontainer

Install a Docker-compatible runtime with Docker Compose and an editor with Dev Containers support. Open the repository's `hub/` directory in the editor and reopen it in the container using `.devcontainer/devcontainer.json`.

Compose starts the app container after PostgreSQL is healthy. Both images use Debian slim bases. The app runs as the non-root `node` user. Container creation runs `npm ci --engine-strict`, which also generates Prisma Client. See the [Dockerfile](../.devcontainer/Dockerfile) and [Compose configuration](../.devcontainer/compose.yaml) for the pinned images.

The repository is mounted at `/workspaces/replica`, with `hub/` as the working directory. Compose supplies `DATABASE_URL` with the `db` service hostname. Local database credentials in Compose are for development only. The database port is published only on host loopback.

## Local Node.js

Use npm and a Node.js version supported by `engines.node` in `hub/package.json`. From `hub/`, start only the database and copy the local configuration:

```sh
docker compose -f .devcontainer/compose.yaml up -d db
cp .env.example .env
npm ci --engine-strict
```

The example URL connects to PostgreSQL on `127.0.0.1:5432`. To use another development database, set `DATABASE_URL` in `.env` instead. Do not commit credentials. The health route does not query the database. Authentication routes require the database and remain unavailable until their settings are configured.

## Start with the real API

Run these commands from `hub/`, inside the devcontainer or with local Node.js:

```sh
npm run dev:api
```

In a second terminal, also from `hub/`, start Vite:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. React Router's Vite development server forwards `/api` requests to Express at <http://127.0.0.1:3001>. `GET /api/health` and `GET /api/ready` return JSON. The [authentication and Hub session guide](authentication.md) describes configured sign-in and enrollment. In real mode, `/` and `/admin-enrollment` show that authentication flow without requesting a product workspace. Product API routes have not been built, so other product pages display API errors rather than falling back to fixtures.

The API registers authentication routes when `HUB_APPLICATION_ORIGIN` and at least one complete GitHub or Entra profile are configured. Set the shared encryption key and bootstrap secret at the same time. See `.env.example` and [Microsoft Entra OIDC](entra-oidc.md). Both development servers accept connections only from this machine. Stop each with Ctrl+C.

No authentication-provider database seed is required. The first sign-in start validates the configured GitHub adapter and persists only its provider key, revision number, and public-configuration digest.

Vite also forwards WebSocket upgrades under `/api`. The `/api/realtime` endpoint rejects connections until application access checks are connected; see [WebSocket updates](websockets.md). Stopping the API closes its WebSocket connections as well.

The API reads an optional `PORT` environment variable, defaulting to 3001. If you change it, update the local Vite proxy target to match. The editor forwards ports 3001, 5173, and 6006 from the devcontainer. API startup reads `.env` when present; Compose's environment takes precedence.

On `SIGINT` or `SIGTERM`, the API stops accepting requests and allows active requests up to `SHUTDOWN_TIMEOUT_MS` (30000 milliseconds by default) to finish, then flushes [optional telemetry](telemetry.md) within five seconds. No automatic request tracing is installed.

## Background workers

The API and frontend do not start background consumers. After starting PostgreSQL, run `npm run setup` once, then start `npm run worker:on-demand` and `npm run worker:scheduled` in separate terminals. Both use `DATABASE_URL`; their concurrency settings are in `.env.example`.

No product jobs or recurring schedules are installed yet. See [Background jobs](background-jobs.md) for definitions, shutdown, migrations, and the compiled commands intended for separate deployment services.

## Database lifecycle

PostgreSQL stores data in a named Compose volume. Stopping or rebuilding the devcontainer preserves it. For a local Node.js setup, stop the database with `docker compose -f .devcontainer/compose.yaml down`; this also preserves data. Do not add `--volumes` unless you intend to permanently delete the local database.

If port 5432 is already in use, stop the conflicting local service or explicitly change the Compose port and the host `.env` URL together. The devcontainer continues to use `db:5432` internally. Startup failures appear in `docker compose -f .devcontainer/compose.yaml logs db`.

Follow the [database guide](database.md) for schema conventions, migrations, and the shared client.

`npm test` needs no database. For tests that save records, follow the [database test setup](testing-and-operations.md#parallel-database-tests).

## Build the app

```sh
npm run build
npm start
```

The build generates Framework route types and produces `dist/client/` and `dist/server/`. `npm start` runs only the compiled API by default. In a separate terminal, `npm run preview` serves the built frontend in real mode for local inspection. Development-only assets are not included in production. The [production image](deployment.md) serves the frontend and API on one port and runs both workers; unknown API routes remain JSON 404 responses rather than returning the frontend document.

Use `npm run storybook` to view the existing components and pages at <http://localhost:6006>. They use sample data, not the new API.

See [Testing and operations](testing-and-operations.md) for checks and [Architecture](architecture.md) for what works and what still needs to be built.

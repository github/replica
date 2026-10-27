# Hub development

Use the Hub devcontainer for Node.js and PostgreSQL, or run Node.js locally with the same database service. GitHub sign-in is optional in local development. Production deployment is not configured.

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

The example URL connects to PostgreSQL on `127.0.0.1:5432`. To use another development database, set `DATABASE_URL` in `.env` instead. Do not commit credentials. Set `HUB_GITHUB_AUTH_CLIENT_ID` and `HUB_GITHUB_AUTH_CLIENT_SECRET` to exercise real GitHub sign-in; leave both unset to run Hub with sign-in disabled. Set separate `HUB_BOOTSTRAP_SECRET` and `HUB_ADMIN_RECOVERY_SECRET` values to exercise first-administrator enrollment and no-administrator recovery.

## Start the app

Run these commands from `hub/`, inside the devcontainer or with local Node.js:

```sh
npm run dev:api
```

In a second terminal, also from `hub/`, start Vite:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the sign-in surface and forwards `/api` requests to Express at <http://127.0.0.1:3001>. `GET /api/health` returns JSON. `GET /api/session` reports the browser session and supplies the CSRF value used by the sign-in and sign-out controls. Both servers accept connections only from this machine. Stop each with Ctrl+C.

The API reads an optional `PORT` environment variable, defaulting to 3001. If you change it, update the local Vite proxy target to match. The editor forwards ports 3001, 5173, and 6006 from the devcontainer. API startup reads `.env` when present; Compose's environment takes precedence.

Hub ignores forwarded client-address headers by default and rate-limits the direct connection address. Keep `HUB_TRUSTED_PROXY_HOPS=0` for local development and any deployment where clients can reach the API directly. A deployment whose API is reachable only through a fixed proxy chain may set the exact number of trusted hops. Every trusted proxy must replace or append the client address correctly, and the network must prevent clients from bypassing the first trusted proxy. Never enable proxy trust only to accept arbitrary `Forwarded` or `X-Forwarded-For` headers.

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

The build produces `dist/client/` and `dist/server/`. `npm start` runs only the compiled API. In a separate terminal, `npm run preview` serves the built frontend for local inspection. Production frontend hosting, API routing, and deployment are not configured.

Use `npm run storybook` to view the existing components and pages at <http://localhost:6006>. They use sample data, not the new API.

See [Testing and operations](testing-and-operations.md) for checks and [Architecture](architecture.md) for what works and what still needs to be built.

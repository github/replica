# Hub development

Use the Hub devcontainer for Node.js and its pinned PostgreSQL version, or run Node.js locally with PostgreSQL 17 or newer. Hub can expose GitHub, Microsoft Entra, or both sign-in choices and reusable administrator enrollment when the shared settings and at least one provider profile are configured. See [Deployment](deployment.md) for the production runtime.

## Frontend without a backend

Follow [Routed frontend](frontend.md) for local startup, data modes, and route examples. The local frontend can run without PostgreSQL or the API server.

## Devcontainer

Install a Docker-compatible runtime with Docker Compose and an editor with Dev Containers support. Open the repository's `hub/` directory in the editor and reopen it in the container using `.devcontainer/devcontainer.json`.

Compose starts the app container after PostgreSQL is healthy. Both images use Debian slim bases. The app runs as the non-root `node` user. Container creation runs `npm ci --engine-strict`, which also generates Prisma Client. See the [Dockerfile](../.devcontainer/Dockerfile) and [Compose configuration](../.devcontainer/compose.yaml) for the pinned images.

The repository is mounted at `/workspaces/replica`, with `hub/` as the working directory. Compose supplies `DATABASE_URL` with the `db` service hostname. Local database credentials in Compose are for development only. The database port is published only on host loopback.

After the container opens and PostgreSQL is healthy, run `npm run setup` before starting `npm run dev:api`. Run setup again after pulling new migrations.

## Local Node.js

Use npm and a Node.js version supported by `engines.node` in `hub/package.json`. From `hub/`, start only the database and copy the local configuration:

```sh
docker compose -f .devcontainer/compose.yaml up -d db
cp .env.example .env
npm ci --engine-strict
npm run setup
```

The example URL connects to PostgreSQL on `127.0.0.1:5432`. To use another development database, set `DATABASE_URL` in `.env` instead. Do not commit credentials. With `DATABASE_URL` set, API startup requires a reachable, migrated database so it can reconcile configured providers and durably disable removed providers before serving requests. Run `npm run setup` after creating or updating the database and before `npm run dev:api`.

For a true process-only health check without database or authentication composition, leave `DATABASE_URL` and all authentication settings unset and run `node server/index.ts` directly. The health route itself does not query the database, but a database-backed API still fails closed at startup when the database is unreachable or its schema has not been set up.

## Start with the real API

Run these commands from `hub/`, inside the devcontainer or with local Node.js. First choose how you will sign in:

| Command | Sign-in | Use it when |
| --- | --- | --- |
| `npm run dev:api` | One fixed local developer who is a Hub administrator | You want to try or test Hub without setting up a sign-in provider. This is the default. |
| `npm run dev:api:live` | GitHub or Entra, as configured in `.env` | You are testing provider sign-in, administrator enrollment through a provider, or real user identities. |

For example, to start with local sign-in:

```sh
npm run dev:api
```

In a second terminal, also from `hub/`, start Vite:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. React Router's Vite development server forwards `/api` requests to Express at <http://127.0.0.1:3001>. `GET /api/health` and `GET /api/ready` return JSON. The [authentication and Hub session guide](authentication.md) describes configured sign-in and enrollment. A signed-in member opens the first available repository, or an empty workspace when none exist. The real index supports search, user filtering, pagination, and latest Build status. Prototype details are read-only; hosted previews, Build history, and live review remain unavailable.

With `npm run dev:api`, the home page shows **Sign in as local developer**. Selecting it signs you in as one fixed local developer who is a Hub administrator. No password or outside account is involved. The API refuses to start in this mode unless `NODE_ENV` is `development` and `DATABASE_URL` points at a local development database. It also requires `HOST` to be `127.0.0.1`, `::1`, or `localhost` and `HUB_APPLICATION_ORIGIN` to be a loopback origin. It refuses GitHub or Entra settings at the same time. Unset origin, encryption key, and bootstrap secret values get local defaults. See [Local developer sign-in](authentication.md#local-developer-sign-in) for how this mode reuses the normal sign-in checks. The command defaults `NODE_ENV` to `development` and enables local sign-in for you.

Remove GitHub or Entra settings from `.env` before switching to local mode; otherwise, use `npm run dev:api:live`. Starting local mode on a database with enabled providers disables those providers. To switch back to live mode on that database, increase the revision of each provider you re-enable by exactly one above its last stored revision. For example, if the last GitHub revision was `1`, set `GITHUB_PROVIDER_REVISION=2`.

With `npm run dev:api:live`, configure `HUB_APPLICATION_ORIGIN`, the shared encryption key, and the bootstrap secret. Sign-in also needs a complete GitHub or Entra profile; without one, the API serves only the GitHub setup page. This command disables local sign-in even if it is enabled in `.env`. See `.env.example` and [Microsoft Entra OIDC](entra-oidc.md). With the default `HOST`, both development servers accept connections only from this machine. Stop each with Ctrl+C.

### GitHub App for local development

Run `npm run env:init` from `hub/` to create `.env` from `.env.example` and generate the encryption key and bootstrap secret. It never replaces a value that is already set and does not print secrets. Use a personal development GitHub App rather than a deployed Hub's App, with `http://127.0.0.1:5173/api/auth/github/callback` as a callback URL. An existing App can be reused by adding this callback URL to it.

Add the App's private key with `npm run env:init -- --private-key path/to/app.private-key.pem`; the script stores it as `GITHUB_APP_PRIVATE_KEY_BASE64`. Fill in the remaining GitHub values in `.env`, restart `npm run dev:api:live`, and refresh <http://127.0.0.1:5173/settings/github/setup> to check status and test the connection. Delete the downloaded `.pem` afterward.

GitHub cannot deliver webhooks to `127.0.0.1`. Local Hubs still refresh repository access at each sign-in and can sync repositories from the setup page. To test webhooks, forward deliveries to `http://127.0.0.1:5173/api/github/webhooks` with a tunnel you control. See [GitHub repository access](authentication.md#github-repository-access).

No authentication-provider database seed is required. API startup validates each configured provider adapter and persists only its provider key, revision number, and public-configuration digest.

To populate a local index, sign in as the local developer once, then run:

```sh
NODE_ENV=development npm run db:seed:index
```

When you sign in through GitHub or Entra instead, find your `userId` in the browser's `/api/auth/session` response and pass it to the seed:

```sh
NODE_ENV=development npm run db:seed:index -- USER_UUID
```

The command requires an active Hub member and a local development database. It accepts a loopback PostgreSQL URL or the exact devcontainer database URL, and rejects query parameters that override the host, address, port, or service. It creates a sample repository and six prototypes with fixed IDs. Five show each Build state, and one has no Build. Their commit and author values are synthetic. Running it again restores those samples, including metadata added after an upgrade. A GitHub member sees only connected repositories granted at sign-in; use an administrator, Entra, or local developer session to view the seeded repository.

Vite also forwards WebSocket upgrades under `/api`. The `/api/realtime` endpoint rejects connections until application access checks are connected; see [WebSocket updates](websockets.md). Stopping the API closes its WebSocket connections as well.

The API reads an optional `PORT` environment variable, defaulting to 3001. If you change it, update the local Vite proxy target to match. The editor forwards ports 3001, 5173, and 6006 from the devcontainer. API startup reads `.env` when present; Compose's environment takes precedence.

On `SIGINT` or `SIGTERM`, the API stops accepting requests and allows active requests up to `SHUTDOWN_TIMEOUT_MS` (30000 milliseconds by default) to finish, then flushes [optional telemetry](telemetry.md) within five seconds. No automatic request tracing is installed.

## Background workers

The API and frontend do not start background consumers. After starting PostgreSQL, run `npm run setup` once, then start `npm run worker:on-demand` and `npm run worker:scheduled` in separate terminals. Both use `DATABASE_URL`; their concurrency settings are in `.env.example`.

The scheduled worker reconciles the configured GitHub installation hourly. See [Background jobs](background-jobs.md) for definitions, shutdown, migrations, and the compiled commands intended for separate deployment services.

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

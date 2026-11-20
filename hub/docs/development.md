# Hub development

Use the Hub devcontainer for API, frontend, database, and worker development, or run Node.js locally with PostgreSQL 17 or newer. Local Build execution requires a Linux host with Docker because the runner starts a nested, constrained Build container; the devcontainer does not expose a Docker daemon. Hub can expose GitHub, Microsoft Entra, or both sign-in choices and reusable administrator enrollment when the shared settings and at least one provider profile are configured. See [Deployment](deployment.md) for the production runtime.

## Frontend without a backend

Follow [Routed frontend](frontend.md) for local startup, data modes, and route examples. The local frontend can run without PostgreSQL or the API server.

## Devcontainer

Install a Docker-compatible runtime with Docker Compose and an editor with Dev Containers support. Open the repository's `hub/` directory in the editor and reopen it in the container using `.devcontainer/devcontainer.json`.

Compose starts the app container after PostgreSQL is healthy. Both images use Debian slim bases. The app runs as the non-root `node` user. Container creation runs `npm ci --engine-strict`, which also generates Prisma Client. See the [Dockerfile](../.devcontainer/Dockerfile) and [Compose configuration](../.devcontainer/compose.yaml) for the pinned images.

The repository is mounted at `/workspaces/replica`, with `hub/` as the working directory. Compose supplies `DATABASE_URL` with the `db` service hostname. Local database credentials in Compose are for development only. The database port is published only on host loopback.

After the container opens and PostgreSQL is healthy, install the separate learning runtime with `npm ci --prefix ../packages/learning --engine-strict`, then run `npm run setup` before starting `npm run dev:api`. Run setup again after pulling new migrations.

## Local Node.js

Use npm and a Node.js version supported by `engines.node` in `hub/package.json`. From `hub/`, start only the database and copy the local configuration:

```sh
docker compose -f .devcontainer/compose.yaml up -d db
cp .env.example .env
npm ci --engine-strict
npm ci --prefix ../packages/learning --engine-strict
npm run setup
```

The example URL connects to PostgreSQL on `127.0.0.1:5432`. To use another development database, set `DATABASE_URL` in `.env` instead. Do not commit credentials. With `DATABASE_URL` set, API startup requires a reachable, migrated database so it can reconcile configured providers and durably disable removed providers before serving requests. Run `npm run setup` after creating or updating the database and before `npm run dev:api`.

For a true process-only health check without database or authentication composition, leave `DATABASE_URL` and all authentication settings unset and run `node server/index.ts` directly. The health route itself does not query the database, but a database-backed API still fails closed at startup when the database is unreachable or its schema has not been set up.

## Start with the real API

Run these commands from `hub/`, inside the devcontainer or with local Node.js. First choose how you will sign in:

| Command | Sign-in | Use it when |
| --- | --- | --- |
| `npm run dev:api` | One fixed local developer who is a Hub administrator | You want local repositories and no sign-in provider. This is the default. |
| `npm run dev:api:live` | GitHub or Entra, as configured in `.env` | You are testing provider sign-in, administrator enrollment through a provider, or real user identities. |

For example, to start with local sign-in:

```sh
npm run dev:api
```

In a second terminal, also from `hub/`, start Vite:

```sh
npm run dev
```

Open <http://localhost:5173>. React Router's Vite development server forwards `/api` requests to Express at <http://127.0.0.1:3001>. `GET /api/health` and `GET /api/ready` return JSON. The [authentication and Hub session guide](authentication.md) describes configured sign-in and enrollment. A signed-in member opens the first available repository, or an empty workspace when none exist. The real index supports search, user filtering, pagination, and latest Build status. Members can browse Build history, select a successful Build with `?build=N`, open its isolated preview, edit visible prototype metadata, use persisted review conversations, and manage [Build-pinned local share links](share-links.md).

With `npm run dev:api`, the home page shows **Sign in as local developer**. Selecting it signs you in as one fixed local developer who is a Hub administrator. No password or outside account is involved. The command explicitly enables `HUB_LOCAL_MODE` and local sign-in and defaults `NODE_ENV` to `development`. The API refuses local mode unless the runtime role is API-only and `DATABASE_URL` points at a local development database. It also requires `HOST` to be `127.0.0.1`, `::1`, or `localhost` and `HUB_APPLICATION_ORIGIN` to be a loopback origin. It refuses GitHub or Entra sign-in and repository connection settings, but an explicitly configured Copilot GitHub App can still be used. Unset origin, encryption key, and bootstrap secret values get local defaults. See [Local developer sign-in](authentication.md#local-developer-sign-in) for how this mode reuses the normal sign-in checks.

Local-mode startup prepares the absolute `LOCAL_PROTOTYPE_ROOT`, defaulting to the ignored `hub/.local/prototypes/` directory. The root is separate from `hub/storage/`, which remains available for production-shaped database, artifact, and learning data. Production, combined, scheduled-worker, and setup runtimes reject local mode rather than changing their startup requirements. The development API, local commands, and local on-demand worker use this root, the optional `LOCAL_REPLICA_BUILD_ACTION_ROOT`, and the optional `LOCAL_BUILD_TEMPORARY_ROOT` through one configuration contract.

When the prototype root is empty, the first start creates `minimal/` from the canonical [Replica Starter](../../starter/), installs its locked dependencies, commits `main`, and creates the committed `prototype/example` branch with a scaffolded example route. The commits use fixed example authorship and timestamps so the same starter revision produces the same repository history. Preparation also installs the shared [Build action](../../actions/build/) runtime dependencies from its lockfile and its pinned Chromium browser. It skips the npm install when the required dependencies are already present; Playwright's browser installation is idempotent.

Later starts always prepare the shared Build action dependencies, but they do not add, replace, switch, or commit anything in a nonempty prototype root. This includes the seeded repository after a developer edits it. To prepare without keeping the API running, use:

```sh
npm run local:prepare
```

To add another local repository, create a Git repository as an immediate child of the configured root and give its default branch at least one commit. Keep unrelated repositories and production data outside this directory.

Remove GitHub or Entra sign-in and repository connection settings from `.env` before switching to local mode; otherwise, use `npm run dev:api:live`. Starting local mode on a database with enabled providers disables those providers. To switch back to live mode on that database, increase the revision of each provider you re-enable by exactly one above its last stored revision. For example, if the last GitHub revision was `1`, set `GITHUB_PROVIDER_REVISION=2`.

With `npm run dev:api:live`, configure `HUB_APPLICATION_ORIGIN`, the shared encryption key, and the bootstrap secret. Sign-in also needs a complete GitHub or Entra profile; without one, the API serves only the GitHub setup page. This command disables local sign-in even if it is enabled in `.env`. See `.env.example` and [Microsoft Entra OIDC](entra-oidc.md). With the default `HOST`, both development servers accept connections only from this machine. Stop each with Ctrl+C.

### GitHub App for local development

Run `npm run env:init` from `hub/` to create `.env` from `.env.example` and generate the encryption key and bootstrap secret. It never replaces a value that is already set and does not print secrets. Use a personal development GitHub App rather than a deployed Hub's App, with `http://127.0.0.1:5173/api/auth/github/callback` as a callback URL. An existing App can be reused by adding this callback URL to it.

Add the App's private key with `npm run env:init -- --private-key path/to/app.private-key.pem`; the script stores it as `GITHUB_APP_PRIVATE_KEY_BASE64`. Fill in the remaining GitHub values in `.env`, restart `npm run dev:api:live`, and refresh <http://127.0.0.1:5173/settings/github/setup> to check status and test the connection. Delete the downloaded `.pem` afterward.

GitHub cannot deliver webhooks to `127.0.0.1`. Local Hubs still refresh repository access at each sign-in and can sync repositories from the setup page. To test webhooks, forward deliveries to `http://127.0.0.1:5173/api/github/webhooks` with a tunnel you control. See [GitHub repository access](authentication.md#github-repository-access).

Configured authentication also registers the administrator-only [`/settings/copilot`](learning-foundation.md) flow. For local or backward-compatible use, explicitly select `REPLICA_COPILOT_AUTHENTICATION=ambient-cli`, or select `environment-token` and set `REPLICA_COPILOT_TOKEN`. These modes attribute usage to the represented individual identity and are not the production default. Without a provider, the page remains available but refuses connection. API and worker startup validate `REPLICA_LEARNING_ROOT` against source and configured static-file roots even before repository learning runs exist.

No authentication-provider database seed is required. API startup validates each configured provider adapter and persists only its provider key, revision number, and public-configuration digest.

To populate a local index, sign in as the local developer once, then run:

```sh
NODE_ENV=development npm run db:seed:index
```

When you sign in through GitHub or Entra instead, find your `userId` in the browser's `/api/auth/session` response and pass it to the seed:

```sh
NODE_ENV=development npm run db:seed:index -- USER_UUID
```

The command requires an active Hub member and a local development database. It accepts a loopback PostgreSQL URL or the exact devcontainer database URL, and rejects query parameters that override the host, address, port, or service. It creates a sample repository and six prototypes with fixed IDs. Five show each Build state, and one has no Build. Their commit and author values are synthetic. When artifact storage is configured, the seed also writes its sample preview files; without storage it remains database-only and omits those artifact records. Running it again restores those samples, including metadata added after an upgrade. A GitHub member sees only connected repositories granted at sign-in; use an administrator, Entra, or local developer session to view the seeded repository. The local repository flow below is limited to one development machine and one local identity.

## Build local prototype repositories

Local Build discovery is a development-only replacement for the old Rails local mode. It needs no GitHub App, remote repository, workflow, or GitHub authorization. Sign in once as the fixed local developer and configure filesystem artifact storage:

```sh
ARTIFACT_STORAGE_PROVIDER=filesystem
ARTIFACT_STORAGE_DIRECTORY=/absolute/service-owned/artifacts
```

The filesystem provider requires the Linux protections described in [Artifact storage](artifact-storage.md). Run local Builds on a Linux host where Docker is available to the Hub process and the configured temporary Build root is visible to that Docker daemon. The standard devcontainer remains suitable for the API, frontend, database, and workers, but it does not expose a Docker daemon for nested Build execution. `npm run dev:api` and every `local:*` command run the same safe preparation first. Run one scan and Build synchronization directly:

```sh
npm run local:builds
```

Starter preparation invokes the [Node.js creator](../../scripts/create-prototype-repo.mjs), not Bash. On Windows, dependency installation runs npm's JavaScript entrypoint through Node.js, using `npm_execpath` when supplied or the npm bundled beside Node.js. These setup fixes do not remove the Linux filesystem requirement or Docker isolation for local Builds.

Alternatively, after `npm run setup`, enqueue the same scan and run the local on-demand worker:

```sh
npm run local:builds:enqueue
npm run local:worker
```

Each scan considers committed heads for the default branch and every other local branch. Hub creates one stable local repository and branch prototype, records the observed head, and creates at most one Build for that exact commit. An unchanged successful or failed head is not rebuilt. A queued or interrupted running Build may resume. Discovery and Build failures are isolated so another repository can still finish.

From a discovered repository's gallery, choose **Edit prototype listings** to add a draft branch to Hub or change a listed prototype's details. Adding a branch makes it appear in the gallery without creating or changing a Build. The default branch, replicas, deleted branches, and the reserved installation branch do not appear in the list. For a GitHub-backed repository, Hub confirms current Write, Maintain, or Admin permission and checks that a branch still exists before adding it.

The runner uses an isolated detached Git worktree for the exact commit, so working-tree changes and untracked files do not enter the Build. Successful packages store validated `dist` files, screenshots, and the optional template manifest as immutable artifact bytes. Hub records failed state and a bounded error summary when validation, the prototype build, screenshots, packaging, storage, or persistence fails.

Successful local Builds are immediately available to the authenticated [preview layer](build-previews.md) through their saved `BuildArtifact` records. The preview and screenshot URLs use the same artifact paths and storage keys written by synchronization; no import or second artifact representation is required. The injected preview bridge supplies element and area anchors to the parent Hub page. The fixed local identity can list and change persisted conversations for those configured repositories while each thread remains pinned to the successful Build where it began. After a local administrator enables deployment sharing, the same saved preview can receive an opaque public link through the [local sharing contract](share-links.md).

Reviews and share links do not modify or duplicate Build artifacts. Public links do not expose review or repository data. The local identity can use review reactions, Canvas pairing, and analytics settings without GitHub. Use separate authorized GitHub identities to exercise hosted permissions and mention and Inbox behavior across accounts.

Vite forwards `/api/realtime` for [authenticated review updates](websockets.md). Stopping the API closes its WebSocket connections.

The API reads an optional `PORT` environment variable, defaulting to 3001. If you change it, update the local Vite proxy target to match. The editor forwards ports 3001, 5173, and 6006 from the devcontainer. API startup reads `.env` when present; Compose's environment takes precedence.

On `SIGINT` or `SIGTERM`, the API stops accepting requests and allows active requests up to `SHUTDOWN_TIMEOUT_MS` (30000 milliseconds by default) to finish, then flushes [optional telemetry](telemetry.md) within five seconds. No automatic request tracing is installed.

## Background workers

The API and frontend do not start background consumers. After starting PostgreSQL, run `npm run setup` once, then start `npm run worker:on-demand` and `npm run worker:scheduled` in separate terminals. Both use `DATABASE_URL`; their concurrency settings are in `.env.example`.

The scheduled worker reconciles the configured GitHub installation every 15 minutes and runs [GitHub Build recovery](github-actions-builds.md#recovery). When `REPLICA_LEARNING_AUTOMATIC_RUNS=true`, it also discovers due learning repositories daily at 02:00 UTC and executes automatic runs without consuming on-demand capacity. See [Background jobs](background-jobs.md) for definitions, shutdown, migrations, and the compiled commands intended for separate deployment services.

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

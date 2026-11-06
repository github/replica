# Deploy Hub

The Hub image runs the frontend, API, and both workers together. It can expose GitHub sign-in and reusable administrator enrollment when their settings are configured. It does not yet implement artifact import, preview hosting, or reviews. Do not treat the health endpoint as proof of those product flows.

## Image and runtime

Build from the repository root with `docker build -t replica-hub:check hub`. When an npm proxy is required, add `--build-arg NPM_REGISTRY=https://YOUR_PROXY/`. This resolves locked dependency versions through that registry without changing the source lockfile; the registry URL must not contain credentials. The image runs as a non-root user and contains compiled application code and migration tooling. It writes no application state to its writable layer. Publish and deploy the same image digest for setup and Hub.

Host npm configuration is not inherited by the image build. Without `NPM_REGISTRY`, the container needs public npm access. Use `--build-arg NPM_REGISTRY=https://packagefeedproxy.microsoft.io/npm/` where public npm access is not allowed. Explicit scoped registry mappings in the copied `.npmrc` still apply.

Publishing is an explicit operator step, not a side effect of CI. From the approved checkout, authenticate to an authorized registry, then run `docker buildx build --platform linux/amd64 --tag YOUR_REGISTRY/replica-hub:YOUR_COMMIT --push hub`. Resolve the published digest with `docker buildx imagetools inspect YOUR_REGISTRY/replica-hub:YOUR_COMMIT` and give deployment the `registry/repository@sha256:...` reference, never the mutable tag.

| Setting                                                  | Contract                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNTIME_MODE`                                           | `api` for source development; the image defaults to `combined`. `on-demand`, `scheduled`, and `setup` are separate roles using the same image. |
| `HOST`, `PORT`                                           | Source defaults to `127.0.0.1:3001`; the image binds `0.0.0.0:3001`.                                                                           |
| `DATABASE_URL`                                           | PostgreSQL connection URL, required for combined, worker, and setup modes. Configure verified TLS for remote databases.                        |
| `DATABASE_RUNTIME_ROLE`                                  | Setup-only opt-in for separate database roles: exactly `replica_runtime`. See [database access](database.md#deployment-database-roles).        |
| `CLIENT_DIRECTORY`                                       | Absolute directory containing built frontend assets and `index.html`; the image uses `/app/dist/client`. Leave unset for the development API.  |
| `SHUTDOWN_TIMEOUT_MS`                                    | Request and worker drain deadline, default 30000 milliseconds. Allow another five seconds for telemetry flushing.                              |
| `ON_DEMAND_JOB_CONCURRENCY`, `SCHEDULED_JOB_CONCURRENCY` | Independent worker concurrency, as described in [Background jobs](background-jobs.md).                                                         |
| `HUB_APPLICATION_ORIGIN`                                 | Exact public HTTP origin. Setting it enables the authentication routes and requires the remaining authentication settings below.                |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                | GitHub App user-authorization credentials. Keep the secret in protected runtime configuration.                                                 |
| `GITHUB_PROVIDER_REVISION`                               | Positive configured adapter revision. Hub validates and selects the matching public-configuration digest.                                     |
| `HUB_AUTHENTICATION_ENCRYPTION_KEY`                      | Base64-encoded 32-byte key used only for short-lived authorization-attempt verifier state.                                                     |
| `HUB_BOOTSTRAP_SECRET`                                   | Reusable high-entropy secret, at least 32 characters, for administrator enrollment.                                                            |
| `HUB_TRUSTED_PROXY_HOPS`                                 | Exact protected proxy-chain length, default 0. Configure this for the deployment ingress before enabling authentication.                       |

Configuration errors stop startup without printing credentials. Logging and optional tracing retain their existing [logging](logging.md) and [telemetry](telemetry.md) contracts.

The runtime serves built frontend navigation and static files on the API port. Unknown `/api` endpoints remain JSON 404 responses. Missing files with extensions do not return the frontend document.

`/api/health` is liveness. `/api/ready` returns 503 during initialization, shutdown, or a failed dependency check. In combined mode it requires both workers to initialize and a successful PostgreSQL query. Worker readiness records initialization only, not continuous consumer health: a later worker connection error can be logged while readiness still succeeds. The PostgreSQL query checks current database availability. When [artifact storage](artifact-storage.md) is configured, both API and combined modes also require its bounded, non-writing availability check. Readiness is an operational signal, not authorization.

On termination, combined mode stops all three roles and drains work within the configured deadline. A required role failing or stopping unexpectedly fails the container. Roles remain independently runnable for future deployments; cross-instance WebSocket delivery is not implemented.

## Setup before release

Run `npm run setup` from `hub/`, or invoke `node dist/server/scripts/setup/index.js` inside the image. Normal API and worker startup never runs setup.

The script holds a PostgreSQL session advisory lock across Prisma migrations, BullMQ migrations, and schedule registration. While the lock connection is healthy, a competing setup fails without starting those steps. Losing that connection releases the lock immediately and requests termination of the current step; child termination can take up to five seconds. The lock alone cannot exclude another invocation during that interval. Setup waits for child cleanup and exits unsuccessfully; logs identify the step without exposing migration-tool diagnostics that could contain secrets.

Only setup scripts should modify migration and schedule state during a release. `npm run jobs:setup` remains a development-only shortcut that does not acquire the full release lock. Operational entry points live under `server/scripts/`; domains do not invoke them.

Migrations are not one transaction across both schemas. Fix the failed step and retry setup before starting the new image. Keep schema and schedule changes compatible with the previous image. Application rollback changes the image, not the database schema.

The deployment orchestrator owns serialization of the complete release, including setup and rollout. It must retain exclusion after failure and confirm that prior setup executions and database work have stopped before allowing a retry. Do not invoke production setup outside that serialized procedure. The advisory lock is an additional check for concurrent setup, not a replacement for release serialization or a guarantee of exactly-once jobs. Release orchestration must also define old/new worker overlap. See [Background jobs](background-jobs.md#schedules-and-delivery-guarantees).

## Scope and evidence

CI checks the image against disposable PostgreSQL, including setup, frontend/API serving, readiness, and termination. Set `NPM_REGISTRY` when running `node hub/script/check-image/index.ts` locally if the build requires a proxy. This is not a supported local-production installation. The existing devcontainer remains the development environment.

The [Azure reference installation](../../infrastructure/README.md) uses Terraform and a serialized maintenance-window release. It consumes the same image but does not yet configure the optional authentication settings. Add those protected settings and the exact Container Apps proxy-chain length before enabling authentication there.

An actual cloud deployment must additionally verify credentials, networking, data survival, backup and restore, domain configuration, and release ordering in an authorized environment. Never commit secrets, tenant-specific parameter files, or generated service addresses.

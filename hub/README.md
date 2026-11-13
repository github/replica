# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API has liveness, readiness, and read-only repository index routes. React Router also connects the retained frontend pages to local mock data.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. The backend provides:

- A provider-neutral identity foundation and configured [GitHub authentication](docs/authentication.md).
- PostgreSQL-backed [background jobs](docs/background-jobs.md) with separate on-demand and scheduled workers. A scheduled job reconciles the GitHub App installation's repositories.
- Explicit server-side [telemetry spans](docs/telemetry.md).
- A [WebSocket foundation](docs/websockets.md) that rejects upgrades until application access checks are supplied.

The read-only index can show seeded prototypes and repositories connected through a GitHub App. Product editing and live multi-user reviews are not implemented.

The [production runtime](docs/deployment.md) packages the frontend, API, and workers in one image, with a separate release setup script.

Use [Development](docs/development.md) to start the API and frontend, and [Routed frontend](docs/frontend.md) for connected routes, local modes, and the division between UI and backend work. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action consume shared canvas and Controls source under [client/](client/). They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

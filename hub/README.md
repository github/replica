# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

Signed-in members can browse repositories, preview Builds and templates, create a prototype brief, and review a saved Build. React Router uses the Express API and PostgreSQL in real mode, and local fixtures only in mock mode.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. The backend provides:

- A provider-neutral identity foundation and configured [GitHub authentication](docs/authentication.md).
- PostgreSQL-backed [background jobs](docs/background-jobs.md) with separate on-demand and scheduled workers. A scheduled job reconciles the GitHub App installation's repositories.
- Explicit server-side [telemetry spans](docs/telemetry.md).
- Authenticated [WebSocket updates](docs/websockets.md) for saved review activity.

Hub builds local branches from committed checkouts or [imports Builds from GitHub Actions](docs/github-actions-builds.md). Repository roles govern hosted listings, analytics, audit, and public sharing. [Review collaboration](docs/review-collaboration.md) includes an Inbox, and the [Replica extension](docs/prototype-canvas.md) can pair with Hub. Hosted public sharing and analytics delivery are off by default.

The [production runtime](docs/deployment.md) packages the frontend, API, and workers in one image, with a separate release setup script.

Use [Development](docs/development.md) to start the API and frontend, and [Routed frontend](docs/frontend.md) for connected routes, local modes, and the division between UI and backend work. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action consume shared canvas and Controls source under [client/](client/). They remain separate projects.

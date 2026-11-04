# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API has liveness and readiness routes. React Router connects all retained frontend pages to local mock flows, including creation, reviews, sharing, setup, and administration. Run `npm run dev:mock` to explore them using fixture data and MSW without an API server, database, or credentials. Real product API routes and public authentication flows are not implemented.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. The database includes a provider-neutral identity foundation and internal [authentication proof primitives](docs/authentication.md). The [background-job foundation](docs/background-jobs.md) provides PostgreSQL-backed BullMQ queues and independent on-demand and scheduled workers, without product jobs yet. [Telemetry](docs/telemetry.md) supports explicit server-side spans, and the [WebSocket foundation](docs/websockets.md) rejects upgrades until application access checks are supplied. Production sign-in, persisted prototype data, and live multi-user reviews are not implemented.

The [production runtime](docs/deployment.md) packages the frontend, API, and workers in one image, with a separate release setup script.

Use [Development](docs/development.md) to start the API and frontend, and [Routed frontend](docs/frontend.md) for connected routes, mock lifecycle, and the division between simulated UI and backend work. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action consume shared canvas and Controls source under [client/](client/). They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

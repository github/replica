# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API has one route: `GET /api/health`. React Router connects all retained frontend pages to coherent local mock flows, including creation, reviews, sharing, setup, and administration. Run `npm run dev:mock` to explore them using synthetic JSON and MSW without an API server, database, or credentials. Real product API routes and authentication are not implemented.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. The [background-job foundation](docs/background-jobs.md) provides PostgreSQL-backed BullMQ queues and independent on-demand and scheduled workers, without product jobs yet. The database has no product models. Production sign-in, persisted product data, live multi-user updates, and deployment are not implemented.

Use [Development](docs/development.md) to start the API and frontend, and [Routed frontend](docs/frontend.md) for connected routes, mock lifecycle, and the division between simulated UI and backend work. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action still use the shared canvas and Controls code at its existing paths. They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

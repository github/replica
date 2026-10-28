# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API has one route: `GET /api/health`. The frontend displays the existing Replica logo and supports light and dark themes. Existing components, features, and pages are kept in Storybook, but they are not connected to the new API.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. The [background-job foundation](docs/background-jobs.md) provides PostgreSQL-backed BullMQ queues and independent on-demand and scheduled workers, without product jobs yet. The database has no product models. Sign-in, saved product data, live updates, and deployment are not implemented.

Use [Development](docs/development.md) to start the API and frontend. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action still use the shared canvas and Controls code at its existing paths. They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API exposes its health check and GitHub authentication and session routes. The frontend provides the minimal GitHub sign-in and sign-out surface with light and dark themes. Existing components, features, and pages remain in Storybook, but they are not connected to product APIs.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. The database has no product models yet. GitHub sign-in works when its dedicated client credentials are configured; invitations, membership administration, product authorization, saved product data, live updates, background jobs, and deployment are not implemented.

Use [Development](docs/development.md) to start the API and frontend. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action still use the shared canvas and Controls code at its existing paths. They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

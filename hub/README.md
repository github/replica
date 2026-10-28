# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API exposes its health check, GitHub authentication, sessions, and installation membership administration. The frontend provides GitHub sign-in, one-use administrator enrollment and recovery, and a minimal membership administration surface. Existing prototype components, features, and pages remain in Storybook, but they are not connected to the new product APIs.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. GitHub sign-in works when its dedicated client credentials are configured. Hub-owned admission, invitations, membership roles and lifecycle, administrator recovery, and session revocation are implemented. Prototype authorization, saved prototype data, live updates, background jobs, and deployment are not implemented.

Use [Development](docs/development.md) to start the API and frontend. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action still use the shared canvas and Controls code at its existing paths. They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

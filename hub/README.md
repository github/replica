# Replica Hub

Hub is being rebuilt on `build/hub/new` using TypeScript, Express, React, Vite, and Vitest. This branch lets contributors start the new app locally. It is not ready to replace the existing Hub.

The API exposes its health check, GitHub or production OIDC authentication, sessions, installation membership administration, prototype authorization, opt-in GitHub-synchronized admission and prototype baselines, and provider-neutral artifact publishing. The frontend provides configured-provider sign-in, one-use administrator enrollment and recovery, and a minimal membership administration surface. Existing prototype components, features, and pages remain in Storybook, but they are not connected to the new product APIs.

Contributors can use PostgreSQL and Prisma locally or in the devcontainer. One configured GitHub or OIDC provider proves user identity. Hub-owned admission, optional GitHub-synchronized authorization with Hub overrides, invitations, membership roles and lifecycle, administrator recovery, session revocation, prototype metadata, and artifact ingestion are implemented. Previews, reviews, SCIM, live updates, general background-job infrastructure, and deployment are not implemented.

Use [Development](docs/development.md) to start the API and frontend. Review [Architecture](docs/architecture.md), [code architecture conventions](docs/backend-architecture.md), and [coding conventions](docs/coding-conventions.md) before adding behavior.

The prototype extension and build action still use the shared canvas and Controls code at its existing paths. They remain separate projects. Their Hub connections will need new API routes before they can work with this branch.

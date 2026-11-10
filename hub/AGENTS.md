# Working on Replica Hub

Hub is being rebuilt in TypeScript. The app starts locally, but its product features are not built yet. Read the [root instructions](../AGENTS.md), [shared guides](../docs/README.md), and [Hub documentation](docs/README.md) before editing.

- [Architecture](docs/architecture.md) explains the chosen tools, what works, and what has not been built.
- [Code architecture conventions](docs/backend-architecture.md) define repositories, integrations, utilities, domains, and allowed imports.
- [Coding conventions](docs/coding-conventions.md) explain frontend layers, formatting, and interface rules.
- [Database conventions](docs/database.md) define Prisma files, model section order, UUID keys, timestamps, and database naming.
- [Telemetry](docs/telemetry.md) defines explicit spans, safe attributes, operator configuration, and API and worker lifetime.
- [Development](docs/development.md) and [testing](docs/testing-and-operations.md) own local and CI commands.
- [Storybook](docs/storybook.md#ui-changes-and-pull-request-evidence) owns presentation coverage, cleanup, and PR screenshots.

Run Node commands from `hub/`, locally or inside the devcontainer. PostgreSQL and Prisma support configured GitHub authentication, administrator enrollment, Hub sessions, and a seeded read-only prototype index; see [authentication](docs/authentication.md). Other prototype APIs and repository-specific permissions are not built. Agree on the design before adding more product models, permissions, deployment choices, or product API routes.

`npm test` does not require PostgreSQL. Use `npm run test:database` for `.db.test.ts` and `.db.test.tsx` cases in Node.js or jsdom. Follow the database isolation and reset rules in [testing](docs/testing-and-operations.md).

Keep the top-level `HubThemeProvider` around Hub and Storybook content. It synchronizes the resolved light/dark mode to `<html data-color-mode>` so portals inherit Brand and `--hub-*` tokens. Do not add a fixed light theme to an overlay.

Keep product copy and presentation independent of mock data. Mock-only controls, notices, and diagnostics belong exclusively in the bottom-right test toolbar. The [frontend guide](docs/frontend.md) owns fixture sizes, persona resets, and the removable mock boundary.

Keep shared canvas and Controls source under `client/`; the prototype extension and build action consume it independently of the Hub API. Update those consumers when source paths change.

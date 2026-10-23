# Working on Replica Hub

Hub is being rebuilt in TypeScript. The app starts locally, but its product features are not built yet. Read the [root instructions](../AGENTS.md), [shared guides](../docs/README.md), and [Hub documentation](docs/README.md) before editing.

- [Architecture](docs/architecture.md) explains the chosen tools, what works, and what has not been built.
- [Code architecture conventions](docs/backend-architecture.md) define repositories, integrations, utilities, domains, and allowed imports.
- [Coding conventions](docs/coding-conventions.md) explain frontend layers, formatting, and interface rules.
- [Development](docs/development.md) and [testing](docs/testing-and-operations.md) own local and CI commands.
- [Storybook](docs/storybook.md#ui-changes-and-pull-request-evidence) owns presentation coverage, cleanup, and PR screenshots.

Run Node commands directly from `hub/`. Agree on the design before adding a database, sign-in, deployment, or product API routes.

Keep the top-level `HubThemeProvider` around Hub and Storybook content. It synchronizes the resolved light/dark mode to `<html data-color-mode>` so portals inherit Brand and `--hub-*` tokens. Do not add a fixed light theme to an overlay.

Preserve the shared canvas and Controls source paths under `app/javascript/`; the prototype extension and build action consume them independently of the Hub API.

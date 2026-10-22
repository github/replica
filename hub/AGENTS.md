# Working on Replica Hub

Replica Hub is a self-hosted Rails application where teams review prototype branches. GitHub owns source code and repository access. Hub stores Builds and review data. Prototype code runs on isolated preview origins.

## Start here

Read the [root instructions](../AGENTS.md) and [shared guides](../docs/README.md), then the [Hub documentation index](docs/README.md) and guides for the work:

- [Development](docs/development.md) for the devcontainer and local runtime.
- [Coding conventions](docs/coding-conventions.md) for Rails, TypeScript, and interface rules.
- [Shared documentation conventions](../docs/documentation-conventions.md) for discussions, product decisions, prose, and handoffs.
- [Testing and operations](docs/testing-and-operations.md) for review and verification.
- [Architecture](docs/architecture.md) and the affected product guide for system boundaries and current behavior.
- [Storybook](docs/storybook.md#ui-changes-and-pull-request-evidence) for UI changes, story coverage, and PR screenshots.

## Working rules

- Extend the existing architecture instead of creating a parallel source, Build, preview, or review flow.
- Use the devcontainer for Ruby and Node commands.
- Keep the top-level `HubThemeProvider` around Hub and Storybook content. It synchronizes the resolved light/dark mode to `<html data-color-mode>` so portals into `document.body` inherit Brand and `--hub-*` tokens. React context alone does not carry CSS inheritance across a portal; do not add a fixed light theme to an overlay.
- Follow the [root Git workflow](../AGENTS.md#git-and-publishing) for checkout checks and publishing steps.

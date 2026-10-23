# Contributor documentation

These guides apply across the Replica monorepo. Start with [Contributing](../CONTRIBUTING.md) for setup and the contribution workflow.

## Prototype guides

[Get started with Replica](getting-started.md) walks new users through installing Copilot, adding their team's repository and canvas, creating a local prototype, and adding controls.

[Set up a prototype repository](prototype-repository-setup.md) guides agents through new or existing repository targets, starter installation, the fresh-session handoff, and a verified local preview before optional product guidance or team setup.

[Set up and configure your prototype environment](prototype-environment.md) walks maintainers through creating the shared repository, adding design-system guidance and starting pages, and inviting the team. Hub publishing and review are not available yet.

## Shared conventions

- [Coding conventions](coding-conventions.md): small, complete changes and behavior-focused tests.
- [Documentation conventions](documentation-conventions.md): plain language, product discussions, and useful diagrams.
- [Testing and review](testing-and-review.md): choosing checks, reviewing changes, and dependency updates.

Commits and pull requests follow the [contribution conventions](../CONTRIBUTING.md#commits-and-pull-requests). Agents start with the [root instructions](../AGENTS.md), then read the instructions for the area they are changing.

## Project guidance

- [Hub documentation](../hub/docs/README.md) covers starting and checking the TypeScript API and frontend, and what is not built yet.
- [Starter instructions](../starter/AGENTS.md) and [setup guide](../starter/SETUP.md) cover the copyable prototype app and skills.
- [Build action setup](../CONTRIBUTING.md#replica-build-action) covers the shared action.
- [Controls documentation](../hub/docs/prototype-controls.md) covers the shared engine and definition schema owned by Hub.
- [Prototype canvas](../hub/docs/prototype-canvas.md) covers the Copilot plugin and injected Controls integration.

Keep project-specific behavior and commands in those guides. The starter is copied into independent repositories, so its instructions must work without this monorepo's root documentation.

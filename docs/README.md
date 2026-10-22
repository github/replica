# Contributor documentation

These guides apply across the Replica monorepo. Start with [Contributing](../CONTRIBUTING.md) for setup and the contribution workflow.

## Prototype guides

[Get started with Replica](getting-started.md) walks new users through installing Copilot, adding their team's repository and canvas, creating and publishing a prototype, sharing feedback, and adding controls.

[Set up a prototype repository](prototype-repository-setup.md) guides agents through new or existing repository targets, starter installation, the fresh-session handoff, and a verified local preview before optional product guidance or team setup.

[Set up and configure your prototype environment](prototype-environment.md) walks environment maintainers through creating the shared repository, adding design-system guidance and templates, deploying Hub with Docker, connecting builds, and inviting the team.

## Shared conventions

- [Coding conventions](coding-conventions.md): small, complete changes and behavior-focused tests.
- [Documentation conventions](documentation-conventions.md): plain language, product discussions, and useful diagrams.
- [Testing and review](testing-and-review.md): choosing checks, reviewing changes, and dependency updates.

Commits and pull requests follow the [contribution conventions](../CONTRIBUTING.md#commits-and-pull-requests). Agents start with the [root instructions](../AGENTS.md), then read the instructions for the area they are changing.

## Project guidance

- [Hub documentation](../hub/docs/README.md) covers the Rails application, deployment, previews, and review collaboration.
- [Starter development](starter-development.md) owns the catalog, shared bundle, assembly contract and checks. [Minimal instructions](../starters/minimal/AGENTS.md) and [CoreAI instructions](../starters/coreai/AGENTS.md) own their apps. The copied [Replica instructions](../starters/shared/REPLICA-AGENTS.md), [workflow guide](../starters/shared/REPLICA.md) and [troubleshooting guide](../starters/shared/SETUP.md) use paths in the assembled repository.
- [Build action setup](../CONTRIBUTING.md#replica-build-action) covers the shared action.
- [Controls documentation](../hub/docs/prototype-controls.md) covers the shared engine and definition schema owned by Hub.
- [Prototype canvas](../hub/docs/prototype-canvas.md) covers the Copilot plugin and injected Controls integration.

Keep project-specific behavior and commands in those guides. The starter is copied into independent repositories, so its instructions must work without this monorepo's root documentation.

# Contributor documentation

These guides apply across the Replica monorepo. Start with [Contributing](../CONTRIBUTING.md) for setup and the contribution workflow.

## Prototype guides

[Create your first local prototype](local-prototyping.md) walks you through the starter and canvas without Hub, then adding approved team guidance and building a useful prototype.

[Set up shared hosting and team feedback](prototype-environment.md) starts with hosting requirements, then team guidance and a useful local prototype. Teams can arrange hosting alongside that work, then connect Hub, publish, and invite teammates.

[Join your team's Replica environment](getting-started.md) walks authors through using an existing team repository and Hub, creating and publishing a prototype, sharing feedback, and adding controls.

[Set up a prototype repository](prototype-repository-setup.md) is the supporting agent guide for new or existing repository targets, starter installation, session handoff, and verification. People following the walkthroughs above do not need to follow its agent instructions.

## Shared conventions

- [Coding conventions](coding-conventions.md): small, complete changes and behavior-focused tests.
- [Documentation conventions](documentation-conventions.md): plain language, product discussions, and useful diagrams.
- [Testing and review](testing-and-review.md): choosing checks, reviewing changes, and dependency updates.

Commits and pull requests follow the [contribution conventions](../CONTRIBUTING.md#commits-and-pull-requests). Agents start with the [root instructions](../AGENTS.md), then read the instructions for the area they are changing.

## Project guidance

- [Hub documentation](../hub/docs/README.md) covers the Rails application, deployment, previews, and review collaboration. Its [operator walkthroughs](../hub/docs/deployment.md#manual-operator-walkthroughs) cover VM installation, Azure DNS/HTTPS, GitHub App connection, updates, source builds, patches, and recovery.
- [Starter development](starter-development.md) owns the catalog, shared bundle, assembly contract and checks. [Minimal instructions](../starters/minimal/AGENTS.md) and [CoreAI instructions](../starters/coreai/AGENTS.md) own their apps. The copied [Replica instructions](../starters/shared/REPLICA-AGENTS.md), [workflow guide](../starters/shared/REPLICA.md) and [troubleshooting guide](../starters/shared/SETUP.md) use paths in the assembled repository.
- [Build action setup](../CONTRIBUTING.md#replica-build-action) covers the shared action.
- [Controls documentation](../hub/docs/prototype-controls.md) covers the shared engine and definition schema owned by Hub.
- [Prototype canvas](../hub/docs/prototype-canvas.md) covers the Copilot plugin and injected Controls integration.

Keep project-specific behavior and commands in those guides. The starter is copied into independent repositories, so its instructions must work without this monorepo's root documentation.

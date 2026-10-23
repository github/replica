# Contributing to Replica

Community contributions are welcome. You can help improve Replica by reporting bugs, suggesting improvements, updating documentation, or submitting pull requests. You do not need to work at GitHub to contribute.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) when participating.

This repository contains several projects with independent development and validation workflows.

The [shared contributor guides](docs/README.md) apply to every project. Agents should also read the [root instructions](AGENTS.md) and any instructions in the area they are changing.

## Before you start

- Search existing issues and pull requests before proposing a change.
- Open an issue before starting a substantial product, architecture, security, or dependency change. Describe who needs the change, the outcome they need, and what the first version will not cover.
- Small bug fixes and documentation corrections may go directly to a pull request when the intended behavior is clear.
- Keep each contribution focused on one complete user flow or maintenance outcome.

Do not disclose a suspected vulnerability in a public issue or pull request. Follow the private reporting instructions in [Security](SECURITY.md).

## Reporting bugs and suggesting improvements

For bugs, describe what you expected, what happened, and how to reproduce the problem. Include relevant versions and error messages, but remove credentials and private information.

For improvements, explain the problem you want to solve and who would benefit. Discuss substantial changes with maintainers in an issue before starting implementation.

## Set up the development environment

Each Node.js project's `engines.node` declares its supported versions. Hub, Starter, build-action, and Learning CI checks run on both supported Node majors. The composite build action retains its pinned runtime default.

### Replica Hub

Hub has a TypeScript Express API, React + Vite frontend, and PostgreSQL with Prisma. Hosting and review features are not built yet. Use the [Hub devcontainer](hub/docs/development.md#devcontainer), or npm and a Node.js version matching `engines.node` in [hub/package.json](hub/package.json):

```sh
cd hub
npm ci
npm run dev
```

This starts the frontend. In a second terminal, run `cd hub && npm run dev:api` to start the API. See [Hub development](hub/docs/development.md) for database setup, addresses, and commands. A GitHub App is not required.

### Replica Starter

Replica Starter requires npm and a Node.js version matching `engines.node` in [starter/package.json](starter/package.json):

```sh
node --version
cd starter
npm ci
npm run typecheck
npm test
npm run build
```

Update starter skills and context templates directly under `starter/.agents/`. Keep authored context in consuming repositories separate from those shared files. For starter-copy, static context library/link and plugin setup checks, run `node --test scripts/create-prototype-repo.test.mjs scripts/setup-replica-plugin.test.mjs` from the repository root. These checks do not verify agent authoring, semantic preservation or activation behavior; use the setup skill's real-host evaluation protocol for that evidence.

Reuse an existing compatible Node.js installation. If it is unavailable on macOS or Linux, get approval before installing [nodenv](https://github.com/nodenv/nodenv), [node-build](https://github.com/nodenv/node-build), or Node.js, or changing shell configuration. The starter installer does not install them.

### Replica build action

The shared build action requires npm, Chromium, and a Node.js version matching `engines.node` in [actions/build/package.json](actions/build/package.json):

```sh
cd actions/build
npm ci --ignore-scripts
npx playwright install chromium
npm run lint
npm test
```

### Replica learning

The learning package requires npm, Git, and a Node.js version matching `engines.node` in [packages/learning/package.json](packages/learning/package.json):

```sh
cd packages/learning
npm ci
npm run schema:check
npm test
npm run demo
```

`npm ci` also installs the optional Copilot SDK, which labels review comments; the tests replace it with a stand-in, so they need no Copilot access. After changing a schema in `contracts/v1`, run `npm run schema:generate` and commit the regenerated `src/contracts-validators.cjs`. Hub's `npm run lint` lints and checks the formatting of this package. A new memory provider must pass the conformance suite described in [the package guide](packages/learning/README.md).

## Make a change

For agent-assisted rendered checks, interaction tests, screenshots and reviews, use the browser canvas first. Follow [browser validation guidance](AGENTS.md#browser-validation-and-playwright-fallback) and [Repository MCP configuration](.github/mcp.json) for the isolated Playwright MCP fallback only when the canvas is unavailable for a required check. Keep existing automated suites, CI and build-artifact capture drivers unchanged; they run without the Copilot canvas host.

Read the [shared coding conventions](docs/coding-conventions.md) and existing documentation for the area you are changing before editing code.

- For Hub changes, follow the existing system boundaries in [Hub architecture](hub/docs/architecture.md).
- For Hub changes, follow the TypeScript, interface, and test rules in [Hub coding conventions](hub/docs/coding-conventions.md).
- For Hub and canvas UI changes, follow the [Storybook coverage and screenshot requirements](hub/docs/storybook.md#ui-changes-and-pull-request-evidence).
- Follow the [shared documentation conventions](docs/documentation-conventions.md) for prose, labels, errors, and code comments.

## Verify the change

Follow the [shared testing and review guide](docs/testing-and-review.md). For Hub code changes, run a focused test while developing, then run the complete Hub suite when the change is stable. Run this command from `hub/`:

```sh
npm ci
npm run lint
npm run db:validate
npm run typecheck
npm test
npm run build
npm run storybook:build
```

Run `npm run test:database` with the [Hub development database](hub/docs/development.md) for server cases that save records. It prepares separate databases per Vitest worker; ordinary `npm test` remains database-free.

Useful focused commands include:

| Goal            | Command                                         |
| --------------- | ----------------------------------------------- |
| TypeScript test | `npm test -- PATH`                             |
| Type check      | `npm run typecheck`                            |
| Storybook build | `npm run storybook:build`                      |
| Prose review    | `bin/review-prose`                              |

From the repository root, run `hub/bin/review-prose` to include changed prose across all projects. Hub and build-action dependency updates must satisfy the [shared dependency policy](docs/testing-and-review.md#update-dependencies). See [Hub testing and operations](hub/docs/testing-and-operations.md) for the complete Hub check and review workflow.

Repository workflow and dependency checks have their own small npm project:

```sh
npm ci --prefix scripts --ignore-scripts --engine-strict
npm run typecheck --prefix scripts
npm test --prefix scripts
node --test scripts/select-ci-suites.test.mjs
node scripts/check-ci-workflows/index.ts
node scripts/check-dependency-age/index.ts
```

The TypeScript workflow and dependency checks use function directories with colocated Vitest tests. The dependency-age command needs network access to npm and GitHub. `GH_TOKEN` is optional locally and avoids GitHub's unauthenticated API rate limit.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles: `type(optional-scope): short description`. For example, `fix(hub): retain prototype history` or `docs: clarify contribution rules`. Choose a type that reflects the change, such as `feat`, `fix`, `docs`, `refactor`, or `test`. These are conventions for contributors and agents; CI does not enforce PR titles.

Keep commits focused on logical changes so reviewers can follow the PR commit by commit. Use additional commits to respond to review feedback.

Use the [PR template](.github/pull_request_template.md). Write short, simple English paragraphs for someone reading about the change for the first time. Explain why it is needed and what becomes different for users, operators, or contributors. Introduce necessary technical terms rather than relying on jargon. Link the issue when applicable.

Include an accurate Mermaid diagram when it makes a proposed flow or system boundary easier to understand. Before/after diagrams are especially useful when an existing flow changes. Use familiar labels, make clear what changes and what stays the same, and leave diagrams out when a sentence explains the proposal better.

For Hub or canvas UI changes, finish the PR description with screenshots of every added or changed story, following the [Storybook evidence workflow](hub/docs/storybook.md#ui-changes-and-pull-request-evidence). Recordings may supplement the screenshots. Omit validation sections and checklists from the PR description. Do not repeat passing test or CI results. Leave statements such as "CI is green" and "tests passed" out of the description; GitHub displays the checks.

Still run the relevant checks before opening the PR. Mention only known verification gaps that affect the change, such as a required check that could not run or behavior that remains unverified. Describe the actual gap, not whether the agent drafting the description ran tests itself.

## Pull request review

Maintainers may ask for revisions before merging. Contributions are reviewed for correctness, fit with the project's direction, and ongoing maintenance needs. Not every proposal or pull request will be accepted.

## Licensing

By submitting a contribution, you agree that it will be licensed under the project's [MIT License](LICENSE).

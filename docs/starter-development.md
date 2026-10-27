# Develop selectable starters

Replica assembles one app with a shared tooling bundle. Installed repositories are independent: they do not need this monorepo, a workspace package or the catalog to run.

## Sources and ownership

| Source | Owns |
| --- | --- |
| `starters/catalog.tsv` | Stable IDs, source directories, display names and descriptions |
| `starters/minimal/` | Minimal, its TanStack Router app and route scaffold |
| `starters/coreai/` | CoreAI Sandbox, its React Router app, design-system skills and baseline context |
| `starters/shadcn/` | Shadcn, its generation recipe, dashboard integration and app-specific instructions |
| `starters/shared/` | Replica skills and context templates, plugin startup, browser configuration and workflow guides |
| `scripts/create-prototype-repo.sh` | Selection, safe assembly and independent Git initialization |
| `scripts/install-starter.sh` | Download and archive validation before calling the same creator |

Shared files keep their installed relative paths. For example, `starters/shared/.agents/skills/` becomes `.agents/skills/`. The selected app uses the same destination root. Shared and app-owned files may share directories, but may not overwrite files or replace a file with a directory. Creation rejects collisions.

Each app owns its README and `AGENTS.md`; both refer to the copied `REPLICA.md` and `REPLICA-AGENTS.md`. Shared guides use the assembled layout, not monorepo-relative paths. Assemble a repository to check those links and integrations.

## Add a starter

1. Add an app directory named `starters/<name>`. Keep its source, router, dependencies, examples and app-specific instructions there. Copied apps also keep their components and lockfile there. Generated apps follow the generation contract below.
2. Add one tab-separated row to [the catalog](../starters/catalog.tsv): `id`, `source-directory`, `display-name`, `description`. All fields are required. IDs use lowercase letters, digits and single hyphens between words. Source directories use the same naming rule directly under `starters/`, with the repository-relative path recorded in the catalog. IDs and source directories must be unique. `starters/shared` is reserved.
3. Declare `engines.node` and the npm scripts `dev`, `build`, `preview` and `check:starter`. The last script runs that app's own checks and production build; it need not use another app's test or formatting tools. Starter CI runs the supported Node majors listed in its workflow.
4. Produce `dist/index.html` and assets that pass the existing Build contract. Do not add deployment credentials, Hub targets or publishing infrastructure to the template.
5. Link app instructions to the copied shared instructions. Include baseline active context for preconfigured examples when shared authoring skills need it. Keep unknown consuming-team policy explicit; do not manufacture product requirements or silently activate setup drafts.
6. Stage the new source files for local-checkout creation, then run the checks below. Both installers and the CI matrix discover entries from the catalog; do not add starter-specific branches to them.

The catalog is data, not executable shell. Bash reads it without Node.js, and copied starters remain Node-free during creation. Selection happens only during creation; there is no in-place app switch or automatic update of installed repositories.

## Generate an app at creation time

A selected app opts into generation by including a regular, tracked `starter-generator.mjs` at its root. The creator first copies the app and shared bundle into a temporary directory, preserving the same collision and source-safety checks as copied starters. It then runs `node starter-generator.mjs` in that directory. Only this path requires Node.js, npm and the app's documented network access during creation. Listing starters and creating copied apps do not require Node.js.

The generator owns its supported runtime check, dependencies, component sources and app integration. It must leave a complete independent app, including `package.json`, `package-lock.json`, the required scripts and any installed local skills. It must not initialize Git, overwrite shared tooling, leave symlinks or depend on the Replica checkout. A generation failure removes the staging directory and leaves no destination.

The optional creation flag `--preset <preset>` passes one code or name to the generator as an argument. It accepts letters, digits and hyphens, not a pasted shell command. Copied starters reject this flag. Omitting it uses the selected generator's tested default.

The optional `--interactive` flag asks the generator to explain its starting app and offer theme selection in a terminal. Shadcn links to the visual preset builder and accepts a preset token or its tested default. It reuses an explicitly supplied preset. Without a terminal, interactive selection fails with guidance to omit the flag or pass `--preset`; automated creation never waits for a questionnaire. Copied starters and `--list` reject generation options.

Before creating the initial commit, the creator removes the one-time generator entry point, root `node_modules` and root `dist`. It rejects linked or unsupported generated files, Git metadata and missing manifests. It then creates the independent repository with all app sources and the generated lockfile committed on `main`, with no remote. Dependency installation and later session startup use that lockfile; they do not rerun generation.

Shadcn uses this path to fetch official components, a dashboard block and the official shadcn skill. Its recipe and small integration layer live in Replica; the generated component tree lives in the consuming repository. Read [Shadcn's guide](../starters/shadcn/README.md) for its inputs, commands and examples. Keep tool versions explicit. A pinned CLI and npm lockfile do not freeze remotely served registry source, so exact regeneration also needs a versioned registry or retained snapshot. The generated repository's initial commit preserves the actual source it received.

## Check changes

Use a new destination outside Replica whose parent already exists:

```sh
bash scripts/create-prototype-repo.sh --list
bash scripts/check-starter.sh minimal ../check-minimal
bash scripts/check-starter.sh coreai ../check-coreai
bash scripts/check-starter.sh shadcn ../check-shadcn
node --test scripts/create-prototype-repo.test.mjs scripts/shadcn-starter.test.mjs scripts/setup-replica-plugin.test.mjs scripts/select-ci-suites.test.mjs
```

`check-starter.sh` creates the selected app, validates its manifest and lockfile, checks that their Node.js engine declarations match, runs `npm ci --engine-strict` and `npm run check:starter`, then checks the resulting `dist` with the existing Build validator. Generated starters must finish generation before these checks. Use a compatible installed runtime and the selected app's registry access. These commands do not install Node.js, enable the Copilot plugin, start a preview or publish.

Checkout creation copies tracked files with their current working-tree contents. It excludes untracked files, dependencies, generated output and source Git metadata. New files must be staged before this path includes them; commits are not required. The downloader uses validated regular files from the source archive. Both paths reject linked files, unsafe paths, unsupported entries and existing destinations.

Both creation paths commit every copied file, including files matched by starter ignore rules, in a new repository on `main` with no remote. The initial commit fixes the missing-`HEAD` failure that prevents worktrees and branch-based tools from starting. Creation uses the caller's Git identity and configuration; staging or commit failures remove the incomplete destination and report recovery guidance.

Starter CI expands the catalog across its Node matrix and checks assembled repositories. npm caching uses the selected app's source manifests, including a lockfile when present. Generated starters resolve their lockfile during creation; the assembled check verifies it. The tooling suite covers local and archive creation, generation, presets, selection, future entries, collisions, safety and copied guidance without fetching UI registries. [Shared testing guidance](testing-and-review.md) owns the additional selector and workflow checks.

Rendered acceptance is separate from assembly and build checks. Follow the selected app's instructions and the shared browser workflow when checking the included UI. An unavailable package or browser is an explicit verification blocker, not a reason to change dependencies or claim a rendered pass.

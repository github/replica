# Develop selectable starters

Replica assembles one app with a shared tooling bundle. Installed repositories are independent: they do not need this monorepo, a workspace package or the catalog to run.

## Sources and ownership

| Source | Owns |
| --- | --- |
| `starters/catalog.tsv` | Stable IDs, source directories, display names and descriptions |
| `starters/minimal/` | Minimal, its TanStack Router app and route scaffold |
| `starters/coreai/` | CoreAI Sandbox, its React Router app, design-system skills and baseline context |
| `starters/shared/` | Replica skills and context templates, plugin startup, browser configuration and workflow guides |
| `scripts/create-prototype-repo.sh` | Selection, safe assembly and independent Git initialization |
| `scripts/install-starter.sh` | Download and archive validation before calling the same creator |

Shared files keep their installed relative paths. For example, `starters/shared/.agents/skills/` becomes `.agents/skills/`. The selected app uses the same destination root. Shared and app-owned files may share directories, but may not overwrite files or replace a file with a directory. Creation rejects collisions.

Each app owns its README and `AGENTS.md`; both refer to the copied `REPLICA.md` and `REPLICA-AGENTS.md`. Shared guides use the assembled layout, not monorepo-relative paths. Assemble a repository to check those links and integrations.

## Add a starter

1. Add an app directory named `starters/<name>`. Keep its source, router, components, dependencies, lockfile, examples and app-specific skills there.
2. Add one tab-separated row to [the catalog](../starters/catalog.tsv): `id`, `source-directory`, `display-name`, `description`. All fields are required. IDs use lowercase letters, digits and single hyphens between words. Source directories use the same naming rule directly under `starters/`, with the repository-relative path recorded in the catalog. IDs and source directories must be unique. `starters/shared` is reserved.
3. Declare `engines.node` and the npm scripts `dev`, `build`, `preview` and `check:starter`. The last script runs that app's own checks and production build; it need not use another app's test or formatting tools. Starter CI runs the supported Node majors listed in its workflow.
4. Produce `dist/index.html` and assets that pass the existing Build contract. Do not add deployment credentials, Hub targets or publishing infrastructure to the template.
5. Link app instructions to the copied shared instructions. Include baseline active context for preconfigured examples when shared authoring skills need it. Keep unknown consuming-team policy explicit; do not manufacture product requirements or silently activate setup drafts.
6. Stage the new source files for local-checkout creation, then run the checks below. Both installers and the CI matrix discover entries from the catalog; do not add starter-specific branches to them.

The catalog is data, not executable shell. Bash reads it without adding a Node.js prerequisite to repository creation. Selection happens only during creation; there is no in-place app switch or automatic update of installed repositories.

## Check changes

Use a new destination outside Replica whose parent already exists:

```sh
bash scripts/create-prototype-repo.sh --list
bash scripts/check-starter.sh minimal ../check-minimal
bash scripts/check-starter.sh coreai ../check-coreai
node --test scripts/create-prototype-repo.test.mjs scripts/setup-replica-plugin.test.mjs scripts/select-ci-suites.test.mjs
```

`check-starter.sh` creates the selected app, validates its manifest and lockfile, runs `npm ci --engine-strict` and `npm run check:starter`, then checks the resulting `dist` with the existing Build validator. Use a compatible installed runtime and the selected app's registry access. These commands do not install Node.js, enable the Copilot plugin, start a preview or publish.

Checkout creation copies tracked files with their current working-tree contents. It excludes untracked files, dependencies, generated output and source Git metadata. New files must be staged before this path includes them; commits are not required. The downloader uses validated regular files from the source archive. Both paths reject linked files, unsafe paths, unsupported entries and existing destinations.

Starter CI expands the catalog across its Node matrix and checks assembled repositories. The tooling suite covers local and archive creation, selection, future entries, collisions, safety and copied guidance. [Shared testing guidance](testing-and-review.md) owns the additional selector and workflow checks.

Rendered acceptance is separate from assembly and build checks. Follow the selected app's instructions and the shared browser workflow when checking the included UI. An unavailable package or browser is an explicit verification blocker, not a reason to change dependencies or claim a rendered pass.

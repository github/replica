# Shadcn

A working workspace starter with the official shadcn/ui `dashboard-01` cards, interactive chart and data table. The sidebar opens Dashboard, searchable Records with a detail dialog, and a Settings form that reports a successful browser-local save. The data is fictional; there is no backend, authentication or email delivery.

Choose `--starter shadcn` using the [Replica installer](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md). This starter is generated during creation, so Node.js, npm and access to the npm registry, shadcn registry and GitHub are needed at that step. The Replica source contains a recipe and small integration layer, not a committed shadcn component tree.

The copied [Replica guide](REPLICA.md) covers the canvas, Controls, optional product guidance and publishing. Follow [app instructions](AGENTS.md) when editing.

## Run it

In the generated repository, use an installed Node.js version matching `engines.node` in [package.json](package.json):

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. In Copilot, complete the [canvas preflight](REPLICA.md#canvas-preflight) before starting a preview.

`npm ci`, development and builds use the UI sources and npm lockfile already in the repository. They do not rerun the generator, fetch components or update the skill.

## Check changes

```sh
npm run typecheck
npm test
npm run build
```

`npm run check:starter` runs all three checks. `npm run preview` rebuilds and serves the production output, including from a fresh repository without `dist`. The output is `dist/index.html` with relative asset URLs. Hash links such as `#/records` work under hosted Build subpaths without a server-side route fallback.

## Explore and adapt the example

- **Dashboard** composes the official `SectionCards`, `ChartAreaInteractive` and `DataTable` from `dashboard-01` inside the app's working navigation.
- **Records** filters local records by title, ID, category, owner or status. Open a title to inspect its details; a search with no matches includes a clear-search action.
- **Settings** saves a display name, fictional email address and sample notification preference in this browser. Saving shows explicit feedback. The app reports unavailable browser storage rather than claiming the save succeeded.

App integration lives in `src/app.tsx`, `src/records-page.tsx` and `src/settings-page.tsx`. Local record fixtures live in `src/data/records.ts`. Installed UI primitives are in `src/components/ui/`; the `@/` alias resolves to `src/`.

The active context under `.agents/context/` describes this example, not your team's product requirements or brand. Preserve the copied skills and use `/setup-skills` when authoring needs additional approved guidance.

## Creation and upstream inputs

[starter-recipe.json](starter-recipe.json) records the pinned executable tool versions, default Nova preset, Radix base, official block, component list and official skill selection. Creation initializes shadcn in the existing Vite app, installs a broad component set and `dashboard-01`, then runs the pinned skills CLI with `--skill shadcn --agent github-copilot --copy -y`. The copied `.agents/skills/shadcn/` directory sits alongside the shared Replica skills. Before reporting success, the generator runs `npm run check:starter` against the generated sources and fails creation if type checks, tests or the production build fail.

Some icon presets give Spinner narrower props than a native SVG. During creation, [the normalization helper](scripts/normalize-shadcn.mjs) uses the installed TypeScript compiler to align Spinner's prop type with its actual imported icon. If the component supplies its own imported glyph through `icon={...}`, the helper omits only that internal `icon` prop from callers; styling and accessible overrides remain available. It preserves runtime JSX and all other source text, leaves an already-aligned type unchanged, and rejects unfamiliar registry shapes. This step does not run during ordinary installation, development or builds.

Before an agent creates this starter, it asks whether you want the default appearance or want to customize it at [shadcn/create](https://ui.shadcn.com/create?template=vite), unless you already made that choice. For customization, finish choosing the appearance and give the agent the preset code before creation. Opening the generated folder does not rerun this choice.

Pass `--preset CODE` to the Replica installer to apply that code. Pass only the code, not the generated shell command or a URL. The code controls the visual preset; the starter keeps Radix UI, a single Vite app and left-to-right layout. A pasted create command with a different `--base`, template, monorepo or RTL option is not equivalent to this starter. Resolve that difference before choosing the preset; those flags are not exposed by the installer.

For guided setup, opt into `--interactive` in a real terminal. The generator explains the dashboard shape, links to shadcn/create and offers the default preset or a pasted code. An existing `--preset` is reused without another question. Agents resolve the choice in chat and use the default or `--preset` without `--interactive`; CI may use the default without asking. Requesting interactive setup without a terminal fails before installation.

The generator never uses `--force` or `--overwrite` and refuses existing generated app paths. A failed creation must be discarded and retried in a fresh destination, not repaired by running the generator over existing work. The installer removes the one-time generator and dependency directory before creating the initial repository commit.

The generated [starter-provenance.json](starter-provenance.json) records the requested preset, resolved configuration, runtime and CLI versions, skill lock data, npm lock hash, installed source hashes and a separately observed dashboard registry hash. The lockfile and CLI pins do **not** freeze the live shadcn registry, its transitive items or the skill's upstream repository. Two fresh generations can differ. The observed registry response is not proof of the exact response the CLI used. Preserve and review the generated sources and lockfiles to keep an existing repository stable.

Child tools receive telemetry opt-out environment variables. Registry and skill downloads still contact their public upstream services. No global installation is needed.

On Windows, child Git processes receive a temporary `core.longpaths=true` setting so the skill repository can be checked out inside a deep destination. Existing Git configuration is preserved, and no global or repository Git configuration is changed.

The official components, dashboard block and shadcn skill come from [shadcn/ui](https://github.com/shadcn-ui/ui) under the MIT license. Keep [the upstream license](SHADCN-LICENSE.txt) with the copied and adapted sources.

The generator copies the shadcn notice and installed Fontsource license and copyright notices unchanged into `public/licenses/` before checking the build. Vite includes those files in `dist/licenses/` and emits bundled dependency licenses in `dist/licenses/dependencies.txt`. Preserve these notices when sharing the app or its Build output.

# Replica Starter

A minimal starting point for a new prototype. Download and review `scripts/install-starter.sh` from `github/replica` to create an independent, uncommitted repository without cloning Replica. From a local Replica checkout, run `./scripts/create-prototype-repo.sh ../my-prototype` instead. Both paths copy this starter without source history or a remote. Open the new repository in a fresh agent session so it discovers the skills, then use `/setup-skills` to draft context from your product and design-system sources. Review and approve the drafts before building a prototype. See [prototype repository setup](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md) for commands and the path from local preview to optional guidance and a shared baseline.

The app has hash-based routing, a start page, a linked sub-page, and a scaffolded activity example. Replace the example pages with your prototype.

Plain/fresh `/setup-skills` also dispatches one tooling agent after intake to check
user-named token, component and other packages, offer missing dependencies and
attempt approved installs before context writers begin. It reuses the current
app's built-in browser and leaves browser configuration unchanged unless a concrete
required check has an evidenced capability gap. Only then does it consider MCP,
or a permitted repository-local CLI when project-local MCP is unsupported.
It records a short usage/status section in `AGENTS.md`. Package and browser
installations require separate approval. Configure-only and context refresh skip
tooling/package setup.

Hashes beginning with `/`, such as `/#/activity`, identify prototype routes. Other fragments, such as `/#contents`, identify sections on the start page. A copied section link reopens the start page at that section rather than treating its ID as a missing route. Nested routes can include a section fragment, such as `/#/about#team`.

Existing prototypes can adopt `src/app/create-prototype-history/` and its use in `src/app/router.tsx` for section links in local and standalone previews. Hub review links do not require this update. Hub restores section fragments through its injected preview bridge, including for existing Builds, without changing or rebuilding consumer source.

## What's included

- Vite, React, TypeScript
- ESLint with GitHub, TypeScript and React Hooks rules, available through `npm run lint`
- Optional Controls authoring guidance using `public/controls.replica.json`
- Hash-based routing via TanStack Router (`src/app/router.tsx`)
- A start page, sub-page, and seed-backed activity example
  (`src/routes/home`, `src/routes/about`, `src/routes/activity`)
- Repository-local agent skills in `.agents/skills/` and their shared context
  templates in `.agents/context-templates/`
- Ready-to-use [agent instructions](AGENTS.md), copied into the new repository
  with the starter, covering component reuse, validation and the Replica canvas
- Repository-local [isolated Playwright MCP configuration](.github/README.md)
  for authorized rendered checks when canvas inspection is unavailable

Deliberately excluded: any styling system (Primer, Tailwind, or otherwise),
GitHub product UI, bundled product templates, and anything specific to a
particular prototype. Add what your project actually needs.

## Example quality checks

The removable `.replica/checks.json` examples provide **Accessibility source review (GitHub example)** and **Lint**. Both run only when requested in the Canvas checks sidebar and do not require Primer or another component library.

Accessibility uses an independent read-only agent to review semantic names, keyboard/focus implementation, forms and feedback, and content/motion. It assesses source evidence, not rendered accessibility or certification.

Lint runs the installed ESLint directly through `npm run lint` in this checkout, without an agent or a Docker container. Run `npm ci` to install the starter's dependencies first. Exit zero passes, exit one reports lint failures, and configuration or execution errors remain execution errors. The same lint command runs in CI. TypeScript compilation and tests remain separate commands.

The starter uses the official [`eslint-plugin-github`](https://github.com/github/eslint-plugin-github) recommended rules, browser rules for app source, and React rules for components, alongside TypeScript and React Hooks rules. GitHub's internal application rules are not enabled. The neutral starter allows English copy, existing dotted filenames and explicit JSON/TypeScript imports; TypeScript checks resolve typed imports instead of ESLint's Node resolver. Tooling scripts may write console output.

GitHub's plugin declares ESLint 10 support, but its import and JSX accessibility dependencies still declare peer support only through ESLint 9. npm currently warns about those upstream peer declarations during installation; the starter retains ESLint 10 rather than installing an unsupported ESLint release.

Canvas commands have your normal user permissions and can read or change files and access the network, just like terminal commands. Use non-mutating check scripts. Lint does not use `--fix`; automatic execution remains opt-in.

Use an updated Replica extension source snapshot; this capability is not supplied by the pinned Vite plugin. Checks capture saved files on a named prototype branch after its initial commit; no base branch or page mapping is needed.

Every check declares `inputs.include` and optional `inputs.exclude`. Update those patterns as the prototype grows so relevant source and tooling changes invalidate results.
Customize the expectations, assessment inputs, context and instruction files, remove one check entry to
keep the other, or delete `.replica/checks.json` and `.replica/checks/` to remove
both examples. Generated controls bindings remain ignored; check configuration
and instructions are committed source.

The Replica plugin owns the checks schema and validator; this repository needs no schema copy or validation script. Its `validate_checks` Canvas action reads the saved configuration and verifies its structure and guidance files without running checks, requiring a preview or connecting to Hub. Ordinary JSON editors do not get schema-based autocomplete automatically.

With an updated Replica plugin, ask an agent to set up or change checks, or invoke `/replica-setup-checks`. The bundled skill reads the plugin's schema, writes configuration and repository-specific guidance, and validates before handing off. It reuses an open Canvas or opens one in validation mode without starting a preview or automatic checks. New checks stay manual unless you opt into automatic execution.

## Prototype controls

Use `/prototype-controls`, or describe the variation in ordinary language:
"add controls to switch between empty and populated scenarios", "add a slider
for the item count", or "add a dropdown to switch seed data". The skill
creates suitable controls in Replica's panel and wires them to the prototype's
rendering, state or authorized data sources. Product UI fields and filters are
separate from prototype configuration. Start a fresh agent session after copying
the starter or updating skills so the agent discovers the current descriptions.

Put version-1 definitions in `public/controls.replica.json`. Each control contains its binding to ordinary app behavior: a native field/button, CSS property, query/hash setting or optional app-owned API. The Copilot plugin and Hub inject one shared adapter. See the [authoring reference](.agents/skills/prototype-controls/references/authoring.md).

Canvas and Hub store ordinary overrides in the prototype URL as `rc.<scope>.<controlId>`. Absent overrides use JSON defaults. Edits preserve history state without reload or extra history entries. Back/Forward restores settings; reset-all removes overrides and resets inactive sets too. Hidden conditional values return to defaults; ordinary page unmount and return preserves values. Private Controls value files are no longer read or written and remain untouched.

Reload the preview page after definition edits. A missing document means no Controls; invalid definitions show a local error without breaking the ordinary app. Each retained Build includes its own definitions, and publication validates that asset. Build screenshots apply the same injected defaults before capture. Standalone hosting keeps the prototype's own defaults and ordinary interactions.

## Configure feedback for missing pages

Unknown prototype routes, such as `/#/not-built-yet`, display a shared
"This page isn't built in the prototype yet" page. It is the root router's
`notFoundComponent`, not a separate `/404` route, and works locally and in
published previews.

Set `notFoundPageConfig.feedbackUrl` at the top of `src/app/not-found-page/index.tsx`
to your team's Slack channel, GitHub Issues page, or another feedback destination.
The included example links to Replica's Issues page; replace it with your team's
destination before sharing your prototype:

```ts
export const notFoundPageConfig = {
  feedbackUrl: "https://github.com/github/replica/issues",
}
```

With a URL configured, the page shows a green primary **Give feedback** link
(opening in a new tab) and a secondary **Back** button. Leave the URL empty to
hide the feedback prompt and show a green primary **Back** button with a
secondary **Go to start** link instead. There are always exactly two actions.
**Back** uses browser history; **Go to start** opens the prototype's `/` route,
including when someone opens a missing page directly with no previous history.
This is the starter's home route, not the preview start-page setting described
below.

The page uses native HTML and a CSS module without adding a component library.
Adapt `src/app/not-found-page/index.tsx` and its styles to your prototype's design system.
Existing repositories must adopt the page, route adapter, styles, and root-router
registration themselves; updating Hub does not change a prototype's router.
This does not change Hub error pages or responses for missing assets.

## React organization

Route modules own loading and navigation. For example, `src/routes/home/home-route-page/index.tsx` passes a TanStack link to `home-page/index.tsx`, which renders a typed prop without importing the router. The activity loader assembles seed data, and `activity-route-page/index.tsx` passes it to `activity-page/index.tsx`. Keep props in a colocated `types.ts` and styles beside the page. Use `@app/`, `@routes/`, and `@data/` across top-level areas, and relative imports within a route. TypeScript, Vite, and Vitest share these aliases. This structure does not require Hub's design system or Rails.

## Scaffold a neutral prototype route

The included scaffolder creates a raw JSON seed, loader, page, CSS module,
lazy TanStack route, and route wrapper. It uses only React and TanStack Router:

```bash
npm run scaffold -- --slug roadmap --name "Roadmap"
```

The starter already includes the `/activity` route, so choose an unused slug for a new route.

The `create-prototype` skill checks package scripts and this documentation
before scaffolding a new route. Existing pages are edited in place. Repositories
without an applicable scaffold use their local conventions instead. Scaffold
discovery needs no separate repository `CREATE-PROTOTYPE.md` context file,
but the skill's product and design-system context requirements still apply.

It is configured by `prototype-scaffold.config.mjs`, with its generated source
templates in `scaffold-templates/neutral/`. Consumers own the route layout,
scope rules, registry markers, page text, styles, template selection, and
value preparation. The engine in `scripts/scaffold-prototype.mjs` only
validates input, protects against collisions and partial writes, updates
metadata, and selects already-bundled templates.

The engine has a fixed source layout: the registry must be under `src/app/`,
and each generated route must be at `src/routes/<slug>/route.tsx`. The
registry import defaults to `../routes/<slug>/route`; a consumer can specify
`registry.importLine` for another import style, such as `@routes/<slug>/route`.
The generated import must retain a `<path>/<slug>/route` specifier so reruns
and URL collision checks can find its route file. Each generated route must
keep a single-line `path: "..."` property and exported `<camel>StartPage = "..."`
metadata for safe reruns and collision checks.
If the registry also contains inline routes, reserve their paths and
slug/identifier pairs in the consumer config before scaffolding new routes.

The neutral configuration creates seven files: a seed, loader, `route.tsx`,
`<slug>-page/index.tsx`, `<slug>-page/types.ts`, `<slug>-page/styles.module.css`,
and `<slug>-route-page/index.tsx`. It substitutes only validated identifiers plus
JSON-serialized seed and route values. Keep seed fields JSON-serialized instead
of interpolating raw strings, so quotes and backslashes remain valid JSON.
Template CRLF line endings are normalized to LF before one-pass substitution,
keeping generated files consistent across checkouts without rewriting inserted values.
A consumer can use the same small file-reading substitution pattern:

```js
export default {
  registry: { path: "src/app/router.tsx", importsEnd: "// --- end scaffold:imports ---" },
  scopes: { app: { registryEnd: "// --- end scaffold:app-routes ---" } },
  resolveRoutePath: ({ startPage }) => startPage.slice(1),
  templates: {
    createFiles(context) {
      return { [`src/routes/${context.slug}/route.tsx`]: "..." }
    },
  },
}
```

`createFiles` receives `slug`, `name`, `description`, `startPage`, `scope`,
`scopeConfig`, `routePath`, `pascal`, and `camel`. It must create
`src/routes/<slug>/route.tsx`, whose exported `<camel>StartPage` and `path`
are used for safe reruns. Add a `prototype-templates.json` catalog only when
you need `--template`; template selection verifies existing family files and
never copies or overwrites them.

## Set the start page

When creating a prototype, save its initial preview route in the repository-root
`.prototype` file and commit it with the prototype:

```json
{
  "startPage": "/#/activity"
}
```

The starter uses hash routing, so generated pages use `/#/route-name`.
The scaffolder writes this through the consumer's `resolvePrototypeStartPage`
configuration; consumers without this function keep ordinary route paths.
Use `/` to start at the root. The file stores no name, description,
template selection, or data-source setting; page titles and descriptions remain
in their generated seed data.

The Replica canvas reads this file before the prototype exists in Hub. On push,
Hub imports the first valid start page from the exact commit unless Hub already
has a setting. Later pushes cannot replace Hub's value, even when explicitly
cleared to `/`. Keep the file after publishing for local use and new branches.

## Run it

Use npm and an existing Node.js installation matching `engines.node` in [package.json](package.json). Check `node --version` before installing dependencies. If a compatible installation is unavailable on macOS or Linux, obtain approval before installing nodenv, node-build, or Node.js or changing shell configuration; the installer does not do this for you.

```bash
npm ci
npm run dev
```

Open the URL printed by Vite.

Show the requested route before ordinary UI edits and keep the preview on that route. Source-only work and eligible [narrow edits](AGENTS.md#narrow-edits) do not require preview-before-edit.

In Copilot, complete the [canvas preflight](#canvas-preflight) before ordinary UI edits or preview startup, then use the Replica prototype canvas. Normal workflows use a browser preview only under the preflight's fallback conditions; narrow navigation acceptance follows the browser validation skill without the Replica canvas preflight. A disconnected Hub is not the same as an unavailable canvas and does not prevent a local preview.

## Connect the Replica canvas

Open the actual running prototype URL in the Replica canvas. Its installed extension connects ordinary Vite dev/preview and static HTML servers through a separate local preview origin. Multiple previews get independent proxies; closing one does not stop any prototype server or another preview.

Controls use the public JSON definitions described above. The Copilot plugin supplies local integration, while Hub supplies retained Build integration and authorization.

The preview's browser origin differs from the original address. Original-origin storage is not copied, and origin-dependent apps may need additional support. Only unauthenticated loopback previews are supported; restrictive script/framing policies and invalid HTTPS certificates remain blockers. See [Canvas commenting setup](SETUP.md#canvas-commenting) for connection and readiness checks.

After you review and accept the Copilot app's repository configuration,
session setup checks the Replica plugin before installing app dependencies.
An enabled installation needs one local CLI check and no network requests.
If `copilot` is missing from `PATH`, setup checks npm's global installation path and reuses an existing CLI there. Only if neither location has the CLI does setup run `npm install -g @github/copilot`. This works without a shell restart or changing `PATH`, including on later startups. Setup does not reinstall an existing CLI, use sudo, install Node.js, or change shell configuration. The npm global installation directory must be writable when installation is needed.
Setup enables a disabled marketplace installation or installs a missing one
from `github/replica`. It preserves an existing marketplace's branch or release
pin and stops plugin setup on conflicting sources or CLI errors. For an organization-required
pin, register the approved marketplace before setup.

Outside automatic session setup, run `node scripts/setup-replica-plugin.mjs`
manually. The script requires Node.js and npm and uses no agent.
Installation commands run without interactive input and have bounded timeouts;
approval or policy failures need user action. Session startup always attempts `npm ci`, even if CLI installation or plugin setup fails. If dependencies install successfully, startup completes without a hard error, but the Replica canvas remains unavailable until plugin setup succeeds. Dependency installation failures still fail startup.

Session startup runs `node scripts/setup-replica-plugin.mjs --startup`. After `npm ci` finishes, the script prints a final summary of dependency installation and Replica plugin setup, including failure reasons and recovery commands. Plugin installation success does not prove that the current session loaded the canvas; the summary includes the separate activation steps.

Plugin failures also print the cause and recovery guidance when they occur. Repository setup scripts have no documented way to post a chat message; agents do not automatically receive this output. Open the app's setup output to diagnose the failure, then rerun `node scripts/setup-replica-plugin.mjs` after resolving it. Running that script without `--startup` only sets up the plugin and still exits nonzero on failure.
For manual installation, updates or source changes, follow the
[plugin guide](https://github.com/github/replica/blob/main/.github/extensions/replica-prototype/README.md#install).
Keep only one Replica provider active.

### Canvas preflight

Agents complete this gate before ordinary UI edits, prototype preview, publishing or Hub comment work. Source-only tasks and eligible [narrow edits](AGENTS.md#narrow-edits) do not require this preflight unless the user requests an authorized canvas operation.

When `replica-prototype` is available, discover its capabilities before the first required operation and reuse the same-provider schema in this session. Rediscover after a provider reload/reconnect, schema mismatch or explicit request to check for changed capabilities; a timeout alone does not invalidate a schema. Use the existing provider without reinstalling or updating it. If several providers are available, ask which to keep before changing plugin or extension settings.

When the canvas is missing in a canvas-capable host, stop before UI edits or
preview startup and tell the user: Open **Customization**, select **Installed**
in the top-left bar, and make sure both the **Replica plugin** and the
**Replica extension** are enabled. These are separate switches; CLI plugin
enablement does not prove that the extension or canvas is available.
If Replica is absent from Installed, ask the user to check the session setup
output, resolve any reported CLI or policy error, and rerun setup.
Agents leave installation and enablement to the setup script and user controls.

If the canvas is still missing after enabling both, ask the user to start a
fresh Copilot session. CLI changes apply to future sessions; setup success is
not evidence that the current session loaded the canvas. Discover the canvas
again after the user changes settings, and resume only when it is available.
Setup output is for diagnosis, not a reliable message channel to the agent.

If the host lacks canvas support or Copilot plugin management, report the
limitation and use the supported local preview workflow. If an available Replica
canvas fails to open after the documented connection checks, disclose the runtime
blocker and use a browser preview. Browser fallback does not bypass plugin setup,
pending approval or a required fresh session. This preflight does not authorize
plugin installation, updates, source migration, Hub approval or publication. Skills that
exclude setup, such as `review-hub-feedback`, keep their own rules and report a
missing canvas as a blocker instead.

### Connect to Hub

Repository maintainers can merge this `.github/replica.json` into the repository's default branch, replacing the example with their Hub origin:

```json
{
  "version": 1,
  "hub": {
    "origin": "https://replica.example.com"
  }
}
```

Keep `.github/github-app.yml` for Copilot app behavior; it needs no Hub keys or connection scripts. The canvas reads Replica configuration from the origin repository's default branch through authenticated `gh`, not from local prototype edits. The repository must already be installed in Hub. Authors open a running local prototype in the canvas and approve the displayed repository and code in their browser; no Hub URL entry, prototype commit, push, or registration is required for pairing. The machine-local connection is then reused across branches and sessions, renewing until revoked or inactive for 30 days.

### Publish the prototype

Follow the [publishing workflow](AGENTS.md#publishing). Include task-related
local changes in focused commits and leave unrelated work untouched.

Copilot verifies the checkout, current non-default task branch, and `origin`,
then uses the existing `.github/workflows/replica.yml` push workflow. It preserves
metadata, registers the discovered branch through the canvas, waits for Hub to
import the Build matching the pushed commit, and returns that Build's exact URL.
Entry-page checks still apply. Copilot reports incomplete landing-page verification.

## Validate it

Keep the visual preview open. Use the browser canvas first for agent-driven
rendered checks, interaction tests, screenshots and reviews. Discover its current
actions; panel-addressed actions need no separate page acquisition.
When a required capability is unavailable, or inspection remains unreadable
after one bounded same-panel recovery attempt, disclose the blocker and use
the copied [Playwright MCP setup](.github/README.md) only for affected checks
for the exact authorized route in a separate, agent-owned isolated browser.
Review and trust the configuration and start a fresh session to discover its
actual tools. Do not inherit authentication or replay a timed-out interaction.
Report unavailable checks as unverified; tool discovery alone is not a browser
pass. See [browser validation guidance](AGENTS.md#browser-validation-and-playwright-fallback).
Existing automated suites, CI and build-artifact capture keep their configured
drivers because they run without the Copilot canvas host.

```bash
npm run typecheck
npm run test
npm run build
npm run format:check
```

## Agent skills

The skills and context templates are committed with the app, not installed by
npm or pinned by a separate lockfile. Copilot CLI, the Copilot app, and VS Code
discover `.agents/skills/` when an agent starts. Start a new agent session after
copying the starter. The canonical `create-prototype` workflow includes scaffold
discovery and collision checks; no vendored patch is needed.

### First use

This neutral starter includes research templates, not approved product or
design-system facts. Ask `/setup-skills` to configure sources, then author and
assess draft context (plain setup handles both phases; configure-only stops
earlier). Review the drafts and limitations, then separately approve the exact
root/topic files to activate. Setup does not activate by default. The seven
named owner documents live in `.agents/context/` (or the existing
`.github/contexts/` root); optional topics stay directly linked to their owner.
Seven owners do not require seven flat files or a split for every owner: setup
chooses cohesive, task-applicable boundaries and keeps guidance whole when useful.
Prototype skills stop on missing required context rather than inventing policy.

Setup accepts a **design-system MCP, CLI, both, or neither**. Supply the MCP
service name or your existing CLI executable and documentation/help reference;
you do not need an MCP if your design system has a CLI. Setup remembers the
answer in `.agents/context-sources.json`, including a preferred method when both
are supplied. Existing MCP answers and explicit skips are reused without another
transport question. Only established read-only documentation operations are
allowed; setup does not install a CLI or change authentication. Unavailable
tools remain reported access failures. See the
[access contract](.agents/skills/setup-skills/references/source-workflow.md#design-system-cli-access).

### Updating skills

Keep `.agents/context/`, `.agents/context-sources.json`, and custom skills
separate from Replica-owned skills. Updates to `.agents/skills/` and
`.agents/context-templates/` in existing repositories require review; there is
no automatic skills update command.

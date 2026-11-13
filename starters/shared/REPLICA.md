# Replica setup and workflows

Use the app's README for its run commands, framework and examples. Follow [agent instructions](REPLICA-AGENTS.md) for task scope and validation. Start a fresh agent session after repository creation so the copied skills are discovered. Inspecting the included app does not require product guidance or a Hub connection.

## Connect the Replica canvas

Open the actual running prototype URL in the Replica canvas. Its installed extension connects ordinary Vite dev/preview and static HTML servers through a separate local preview origin. Multiple previews get independent proxies; closing one does not stop any prototype server or another preview.

Controls use public JSON definitions. The Copilot plugin supplies local integration, while Hub supplies retained Build integration and authorization.

The preview's browser origin differs from the original address. Original-origin storage is not copied, and origin-dependent apps may need additional support. Only unauthenticated loopback previews are supported; restrictive script/framing policies and invalid HTTPS certificates remain blockers. See [Canvas commenting setup](SETUP.md#canvas-commenting) for connection and readiness checks.

After you review and accept `.github/github-app.yml`, session setup checks the Replica plugin before installing app dependencies. An enabled installation needs one local CLI check and no network requests.

If `copilot` is missing from `PATH`, setup checks npm's global installation path and reuses an existing CLI there. Only if neither location has the CLI does setup run `npm install -g @github/copilot`. Setup does not reinstall an existing CLI, use sudo, install Node.js or change shell configuration. The npm global installation directory must be writable when installation is needed.

Setup enables a disabled marketplace installation or installs a missing one from `github/replica`. It preserves an existing marketplace's branch or release pin and stops plugin setup on conflicting sources or CLI errors. For an organization-required pin, register the approved marketplace before setup.

Outside automatic session setup, run `node scripts/setup-replica-plugin.mjs` manually. The script requires Node.js and npm and uses no agent. Installation commands run without interactive input and have bounded timeouts; approval or policy failures need user action.

Session startup runs `node scripts/setup-replica-plugin.mjs --startup`. It always attempts `npm ci`, even if CLI installation or plugin setup fails. If dependencies install successfully, startup completes without a hard error, but the Replica canvas remains unavailable until plugin setup succeeds. Dependency installation failures still fail startup.

After `npm ci` finishes, the script prints a final summary of dependency installation and Replica plugin setup, including failure reasons and recovery commands. Plugin installation success does not prove that the current session loaded the canvas; the summary includes the separate activation steps.

Agents do not automatically receive this output. Open the app's setup output to diagnose failures, then rerun `node scripts/setup-replica-plugin.mjs` after resolving them. Running that script without `--startup` only sets up the plugin and still exits nonzero on failure. For manual installation, updates or source changes, follow the [plugin guide](https://github.com/github/replica/blob/main/.github/extensions/replica-prototype/README.md#install). Keep only one Replica provider active.

## Canvas preflight

Agents complete this gate before ordinary UI edits, prototype preview, publishing or Hub comment work. Source-only tasks and eligible [narrow edits](REPLICA-AGENTS.md#narrow-edits) do not require it unless the user requests an authorized canvas operation.

When `replica-prototype` is available, discover its capabilities before the first required operation and reuse the same-provider schema in this session. Rediscover after a provider reload/reconnect, schema mismatch or explicit request to check for changed capabilities; a timeout alone does not invalidate a schema. Use the existing provider without reinstalling or updating it. If several providers are available, ask which to keep before changing plugin or extension settings.

When the canvas is missing in a canvas-capable host, stop before UI edits or preview startup and tell the user: Open **Customization**, select **Installed** in the top-left bar, and make sure both the **Replica plugin** and the **Replica extension** are enabled. These are separate switches; CLI plugin enablement does not prove that the extension or canvas is available. If Replica is absent from Installed, ask the user to check the session setup output, resolve any reported CLI or policy error, and rerun setup. Agents leave installation and enablement to the setup script and user controls.

If the canvas is still missing after enabling both, ask the user to start a fresh Copilot session. CLI changes apply to future sessions; setup success is not evidence that the current session loaded the canvas. Discover the canvas again after the user changes settings, and resume only when it is available.

If the host lacks canvas support or Copilot plugin management, report the limitation and use the supported local preview workflow. If an available Replica canvas fails to open after the documented connection checks, disclose the runtime blocker and use a browser preview. Browser fallback does not bypass plugin setup, pending approval or a required fresh session. This preflight does not authorize plugin installation, updates, source migration, Hub approval or publication. Skills that exclude setup, such as `review-hub-feedback`, keep their own rules and report a missing canvas as a blocker instead.

## Connect to Hub

Repository maintainers can merge this `.github/replica.json` into the repository's default branch, replacing the example with their Hub origin:

```json
{
  "version": 1,
  "hub": {
    "origin": "https://replica.example.com"
  }
}
```

Keep `.github/github-app.yml` for Copilot app behavior; it needs no Hub keys or connection scripts. The canvas reads Replica configuration from the origin repository's default branch through authenticated `gh`, not from local prototype edits. The repository must already be installed in Hub.

Authors open a running local prototype in the canvas and approve the displayed repository and code in their browser; no Hub URL entry, prototype commit, push or registration is required for pairing. The machine-local connection is then reused across branches and sessions, renewing until revoked or inactive for 30 days.

## Publish the prototype

Publishing needs a configured repository and its existing `.github/workflows/replica.yml` push workflow. Repository creation alone does not configure Hub or create that workflow. Follow the [environment setup guide](https://github.com/github/replica/blob/main/docs/prototype-environment.md) when hosted publishing is requested.

Follow the [publishing instructions](REPLICA-AGENTS.md#publishing). Include task-related local changes in focused commits and leave unrelated work untouched. Verify the checkout, current non-default task branch and `origin`; use the existing push workflow. Preserve metadata, register the discovered branch through the canvas, wait for Hub to import the Build matching the pushed commit, and return that Build's exact URL. Preserve entry-page checks and report unverified landing pages.

## Set the start page

Save the initial preview route in the repository-root `.prototype` file and commit it with the prototype:

```json
{
  "startPage": "/"
}
```

Use an app-owned route, including its query or hash when needed. The file stores no name, description, template selection or data-source setting.

The Replica canvas reads this file before the prototype exists in Hub. On push, Hub imports the first valid start page from the exact commit unless Hub already has a setting. Later pushes cannot replace Hub's value, even when explicitly cleared to `/`. Keep the file after publishing for local use and new branches.

## Improve guidance from review feedback

Run `/review-hub-feedback` with an approved Hub connection to find reusable themes across prototype reviews. It leaves repository files and Hub feedback unchanged, saves the evidence in private session artifacts, and offers a choice of findings to investigate. Its confidence scores describe theme relevance, not proof of a defect.

After selecting findings, use `/prepare-feedback-proposals` to compare them with existing repository guidance. The skill presents a solution for each investigation: a proposed guidance change, an already-covered finding, a clarification needed, or a suggestion for a separate environment investigation. Every proposed edit is shown before you approve it. Asking for proposals does not authorize edits; only explicit approval of displayed changes does.

The proposal skill changes only reusable repository guidance. It does not fix prototypes or change components, templates, skills, dependencies or configuration. You can decline all proposals. In the same session it uses the saved review; in another session, explicitly select or attach the private review artifact. If that artifact is unavailable, run a new review rather than relying on the summary. Start a fresh agent session after updating starter skills so both skills are discovered.

## Prototype controls

Use `/prototype-controls`, or describe the variation: "add controls to switch between empty and populated scenarios", "add a slider for the item count", or "add a dropdown to switch seed data". The skill creates controls in Replica's panel and wires them to the prototype's rendering, state or authorized data sources. Product UI fields and filters are separate from prototype configuration.

Put version-1 definitions in `public/controls.replica.json`. Each control binds ordinary app behavior: a native field/button, CSS property, query/hash setting or optional app-owned API. The Copilot plugin and Hub inject one shared adapter. See the [authoring reference](.agents/skills/prototype-controls/references/authoring.md).

Canvas and Hub store ordinary overrides in the prototype URL as `rc.<scope>.<controlId>`. Absent overrides use JSON defaults. Edits preserve history state without reload or extra history entries. Back/Forward restores settings; reset-all removes overrides and resets inactive sets too. Hidden conditional values return to defaults; ordinary page unmount and return preserves values. Existing private Controls value files remain untouched.

Reload the preview page after definition edits. A missing document means no Controls; invalid definitions show a local error without breaking the ordinary app. Each retained Build includes its own definitions, and publication validates that asset. Build screenshots apply the same injected defaults before capture. Standalone hosting keeps the prototype's own defaults and ordinary interactions.

## Browser validation

Keep the visual preview open. Use the browser canvas first for agent-driven rendered checks, interaction tests, screenshots and reviews. Follow the [browser validation instructions](REPLICA-AGENTS.md#browser-validation-and-playwright-fallback) and [shared workflow](.agents/skills/browser-canvas-validation/WORKFLOW.md).

When a required capability is unavailable, or inspection remains unreadable after one bounded same-panel recovery attempt, disclose the blocker and use the copied [Playwright MCP setup](.github/README.md) only for affected checks on the exact authorized route in a separate, agent-owned isolated browser. Review and trust the configuration and start a fresh session to discover its actual tools. Do not inherit authentication or replay a timed-out interaction. Report unavailable checks as unverified; tool discovery alone is not a browser pass.

Existing automated suites, CI and build-artifact capture keep their configured drivers because they run without the Copilot canvas host.

## Product guidance and skills

Skills and context templates are committed with the app, not installed by npm or pinned by a separate lockfile. Copilot CLI, the Copilot app and VS Code discover `.agents/skills/` when an agent starts. Start a new agent session after copying the starter or updating skills.

Follow the app's supplied design-system skills and active `.agents/context/` guidance when present. These describe its included example, not your team's product policy. Minimal includes research templates rather than approved product context. Shared authoring skills stop on missing required context rather than inventing policy.

When you want to add or change product and design-system guidance, ask `/setup-skills`. It reuses existing guidance and saved answers, drafts the shared context library and stops for review and separate activation approval. Do not replace supplied app guidance merely because a repository was just created.

Plain/fresh setup offers missing user-named token, component and other packages for approval before context writers begin. It reuses the built-in browser. Browser configuration changes require an evidenced gap for a concrete required check and separate installation approval. Configure-only and context refresh skip tooling/package setup.

The seven named owner documents live in `.agents/context/` or the existing `.github/contexts/` root. Optional topics stay directly linked to their owner. Setup chooses cohesive, task-applicable boundaries and keeps guidance whole when useful.

Setup accepts a design-system CLI or another user-declared documentation source. Use only established read-only documentation operations; setup does not install a CLI or change authentication. See the [source access contract](.agents/skills/setup-skills/references/source-workflow.md#design-system-cli-access).

Keep `.agents/context/`, `.agents/context-sources.json` and app-owned skills separate from Replica-owned skills. Updates to `.agents/skills/` and `.agents/context-templates/` in existing repositories require review; there is no automatic skills update command.

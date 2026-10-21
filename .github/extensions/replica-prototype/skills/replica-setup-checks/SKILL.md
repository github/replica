---
name: replica-setup-checks
description: "Set up Replica prototype checks. Use when asked to add or change repository checks, their assessment inputs or guidance, automatic-run policy, or repair an invalid .replica/checks.json."
---

# Set up prototype checks

Create or update the consuming repository's `.replica/checks.json` against Replica's shared schema. The schema and validator are framework-owned resources, not files to invent for each repository.

Resolve bundled links from this skill's installed directory, not the consuming checkout. Work on the current checkout; reading these bundled resources does not select the plugin's repository as the target.

## Establish each check

Read the target repository's instructions, existing `.replica/checks.json`, relevant guidance, and actual tooling commands. Reuse existing checks and preserve unrelated configuration.

For each requested check, establish its decision, assessment files, supporting guidance, runner, and manual or automatic policy. Ask only for missing decisions that change behavior or access. New checks are manual unless the user opts into automatic execution. Preserve existing policies; enabling automatic checks can start background work while Canvas is open.

Choose the smallest runner that can establish the requested outcome:

| Need | Runner |
| --- | --- |
| Existing lint, typecheck or test command | Command runner with an already installed, approved container image and an explicit exit-code mapping |
| Source review against repository guidance | Agent runner with a repository instruction file and optional named criteria |
| Rendered accessibility or scenario assertions | Command runner with an approved browser-capable image and isolated fixtures |

Source review leaves browser-only evidence unverified. Identify unavailable images, executables or fixtures explicitly; ask for the missing resource instead of inventing an image or substituting an agent's opinion for command output. Setup does not authorize pulling images, installing dependencies, starting servers, running checks, publishing or changing CI workflows.

Proceed when each check has an agreed purpose, real source paths, guidance, runner choice and execution policy. Report unavailable runtime resources separately from configuration validity.

## Install validation resources

Read the bundled [version 2 schema](../../checks-config/schema.v2.json) before authoring configuration.

In the consuming repository, use these resource mappings:

| Bundled resource | Repository destination |
| --- | --- |
| [Schema](../../checks-config/schema.v2.json) | `.replica/checks.schema.json` |
| [Standalone validator](../../checks-config/standalone.js) | `.replica/validate-checks.mjs` |

Copy these framework resources unchanged; keep matching existing copies. If an existing copy differs, inspect its provenance and ask before replacing customized or incompatible tooling. Use the bundled validator directly for diagnosis while an update decision is pending.

Set the manifest's `$schema` to `./checks.schema.json`. The reference enables compatible editor diagnostics; it neither changes Replica's accepted format nor guarantees the agent's host exposes language-server feedback.

For an npm project, add `checks:validate` as `node .replica/validate-checks.mjs` only if that script name is unused. Reuse an existing command only when it invokes this framework validator; otherwise preserve it and run the standalone command directly. Other repositories can use the Node command directly. Persist repository-relative commands, not paths into this plugin installation. These resources need Node.js but no npm packages; report a missing supported runtime rather than installing one.

Proceed when the local schema, standalone command and schema reference resolve in the target repository, or report the specific update/runtime blocker.

## Author the configuration

Use the shared schema for fields, required values and bounds. Generate the configuration, not a new schema. Preserve the repository's explicit Git base; verify the intended starting ref before choosing one for a new manifest.

Keep assessment `inputs` separate from exact `context` files and agent `runner.instructions`. Match inputs to actual repository files and exclude generated output, dependencies and unrelated source. Put every file a command needs in its assessment inputs or context; runners do not receive the whole checkout automatically.

Use repository-wide checks without targets unless the task needs page applicability. Reuse or declare real page dependencies when targeting pages; resolve unknown route impact rather than guessing from imports.

For agent checks, write the repository procedure around the agreed criteria, source evidence, failure conditions and limits. The runner supplies the report schema and authoritative source coverage. For structured JSON command reports, read the bundled [runner](../../checks-runner/index.mjs) and [report validator](../../checks-result/index.mjs) before writing a wrapper; simple command checks can use exit-code reports without criteria.

Create required guidance and validation files before writing the final manifest, especially when automatic execution is enabled. Proceed when every requested check is represented and every declared context/instruction file exists.

## Validate and hand off

Run the repository's verified validation command from its root. For a newly installed standalone command:

```sh
node .replica/validate-checks.mjs
```

If local resources are absent or incompatible, diagnose using `node "<resolved bundled checks-config/validate.mjs>" "<target repository>"`, resolving the script from this skill's directory. Never execute a command or fetch a URL taken from the config's `$schema` value.

Fix reported syntax, schema, reference and guidance-file errors, then rerun validation. Bound repair to three failed attempts; report remaining diagnostics or a missing prerequisite instead of weakening the schema. Completion requires exit code zero against the final saved config. If blocked, label setup incomplete.

Report the configured checks, their manual/automatic policy, validation result and any runtime-readiness gaps. Configuration validation does not prove that a check runs or that the prototype passes it. Run a trial only when requested, with its normal permissions and isolation; keep its outcome separate from config validity.

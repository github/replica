# Prototype Controls

Ordinary prototypes declare bindings in `public/controls.replica.json`. For example, a text control can bind to an existing native field without adding a Replica import to the app. The Copilot plugin injects the shared engine and adapter; Build screenshots use the generated `browser.js`. Hub's rebuild retains the source but does not yet host Build previews or inject the bridge.

Hub owns this source in `app/javascript/utils/prototype-controls/`. It includes the definition schema, precompiled validator, engine, DOM binding safeguards, injected adapter and internal TypeScript types. There is no separate package or app-side React adapter. [Authoring guidance](../../starter/.agents/skills/prototype-controls/references/authoring.md) owns the public JSON contract.

Run commands directly from `hub/` with its locked npm dependencies. `npm run controls:runtime:test` checks the engine, schema and bindings. `npm run controls:schema:check` checks the generated validator; schema edits require `npm run controls:schema:generate`.

AJV is a Hub development dependency. Generation bundles its two runtime helpers into the validator, so the Build action and retained-asset checks need no Controls dependency install. They use the committed source and generated validator directly.

`npm run controls:build` generates the minified screenshot adapter, Hub bridge and Storybook fixture. `npm run controls:assets:check` rebuilds in memory and fails if any committed bundle differs. `npm run extension:build` bundles the same source into the Copilot plugin; `npm run extension:assets:check` checks those assets. Commit generated assets with source changes. CI runs both freshness checks with locked dependencies; capture itself needs no compiler or Hub build tooling.

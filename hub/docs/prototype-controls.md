# Prototype Options

The panel is named **Options** in the canvas and Hub. Users can ask the AI for either "options" or "controls"; the shared `prototype-controls` skill handles both. Existing `controls.replica.json` files, schema fields, APIs and action names remain unchanged.

Ordinary prototypes declare bindings in `public/controls.replica.json`. For example, a text control can bind to an existing native field without adding a Replica import to the app. The Copilot plugin and Hub inject the shared engine and adapter; Build screenshots use the generated `browser.js`. Each retained Build supplies its own static definitions.

Hub owns this source in `app/javascript/utils/prototype-controls/`. It includes the definition schema, precompiled validator, engine, DOM binding safeguards, injected adapter and internal TypeScript types. There is no separate package or app-side React adapter. [Authoring guidance](../../starters/shared/.agents/skills/prototype-controls/references/authoring.md) owns the public JSON contract.

API value bindings may opt into `initial: "app"` to adopt the app's current value without a startup write. Page selectors can then respect direct links and Back/Forward while the app's router remains the source of truth. These values are never saved in `rc.*`; legacy overrides are ignored. Edits and reset still write through the app API, and reset uses the declared default. Other bindings retain their existing defaults and persistence. Hidden controls still return to their defaults.

The option requires Copilot plugin 1.10.1 or a Hub/Build capture runtime containing this schema. Older runtimes reject the definition without breaking the ordinary app. The definition format and Controls protocol remain version `1`.

Run Hub commands in the devcontainer, using its normal locked dependencies. `npm run controls:runtime:test` checks the engine, schema and bindings. `npm run controls:schema:check` checks the generated validator; schema edits require `npm run controls:schema:generate`.

AJV is a Hub development dependency. Generation bundles its two runtime helpers into the validator, so the Build action and retained-asset checks need no Controls dependency install. They use the committed source and generated validator directly.

`npm run controls:build` generates the minified screenshot adapter, Hub bridge and Storybook fixture. `npm run controls:assets:check` rebuilds in memory and fails if any committed bundle differs. `npm run extension:build` bundles the same source into the Copilot plugin; `npm run extension:assets:check` checks those assets. Commit generated assets with source changes. CI runs both freshness checks with locked dependencies; capture itself needs no compiler or Hub build tooling.

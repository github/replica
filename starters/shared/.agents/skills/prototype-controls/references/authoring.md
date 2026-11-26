# Authoring prototype controls

Add `public/controls.replica.json` to expose settings in Replica's Controls panel. For example, this slider changes an existing app field:

```json
{
  "version": 1,
  "scope": "catalog",
  "controls": [
    {
      "id": "items",
      "label": "Items",
      "type": "slider",
      "default": 3,
      "min": 0,
      "max": 20,
      "step": 1,
      "binding": { "type": "field", "selector": "#item-count" }
    }
  ]
}
```

The prototype owns the field and its ordinary app behavior. Replica supplies the engine, validation and panel through the optional Copilot plugin or Hub preview. No Replica npm dependency, Vite plugin, generated source or app helper library is required. Use the build tool's equivalent static-assets directory if it is not `public/`. The output must serve this document at `/controls.replica.json` and include it in the retained Build.

An ordinary standalone prototype keeps its own app defaults and interactions. In Replica and Build screenshots, the injected adapter applies JSON defaults and valid URL overrides. Do not make ordinary app behavior depend on the adapter.

## Definitions

The definition format is version `1`. It is separate from transport/runtime versions and Hub release tags. The document contains either one set, as above, or `{ "version": 1, "sets": [...] }`. Each set is a complete version-1 declaration with a unique `scope`. See [control sets](sets.md) for shared and page lifetimes.

Every control has a unique `id` within its set, a readable `label`, a supported `type` and its own `binding`. All value controls require a valid `default`; buttons do not have values or defaults. Unknown properties and invalid bounds, options or conditions are rejected.

| Type | Value and constraints |
| --- | --- |
| `boolean` | Boolean default |
| `number`, `slider` | Finite numeric default; required `min` and `max`; optional positive `step` (defaults to 1) |
| `select`, `radio`, `segmented` | String default included in the nonempty, unique string `options` |
| `checkboxGroup` | Array default containing unique members of string `options` |
| `text`, `textarea` | String default; optional `minLength`, `maxLength` |
| `color` | Six-digit hex color, such as `#336699` |
| `button` | An ordinary app action; no persisted result |

Keep labels short and use flat, one-level `groups`: `{ "id": "content", "label": "Content" }`. A control's `group` references one of those IDs. Groups are shown where their first field occurs in the controls array and are automatically collapsible. Keep each group's fields together. The app authors definitions, not panel components, CSS or folding flags.

Controls and groups can use `when: { "control": "variant", "equals": "A" }`. Conditions also support `in`, `includes`, `all` and `any`. References stay within the same set and must form an acyclic dependency graph. A hidden value returns to its default and loses its URL override. Showing it again uses its default; ordinary page unmount and return preserves cached values.

## Bind ordinary app behavior

Choose the simplest binding that expresses the requested effect. Selectors must identify exactly one supported, visible, enabled target. Missing, ambiguous or stale targets disable only that control with a reason and reconnect when valid. Do not create hidden fields just to bypass these safeguards.

### Binding targets

Selectors resolve through `querySelectorAll` to exactly one connected
`HTMLElement`. SVG elements fail this check; select a stable HTML wrapper instead.
Targets are rejected when they or an ancestor are hidden, inert, `aria-hidden`,
`aria-disabled`, `display: none`, `visibility: hidden` or `opacity: 0`.
Disabled targets and zero-size targets are also rejected.

Keep a style binding's target available throughout its value range. For opacity,
bind a CSS custom property such as `--preview-opacity` on a stable element such
as `body`, then consume it on the affected content in CSS. Binding `opacity`
directly can hide the target and prevent further edits or reset.

Primer IconButton tooltip labels do not set `aria-label` on the button element.
Use a verified ID or `data-testid` rather than assuming an `[aria-label]` selector
matches. Check the rendered element and the actual selector, not its tooltip.

| Binding | Example | Behavior |
| --- | --- | --- |
| Native field | `{ "type": "field", "selector": "#item-count" }` | Changes an input, select or textarea and dispatches ordinary input/change events |
| Native button | `{ "type": "button", "selector": "#add-item" }` | Clicks a safe standalone button; never retries it automatically |
| Style | `{ "type": "style", "selector": ".preview", "property": "--density" }` | Reads and writes a CSS property or custom property |
| Query parameter | `{ "type": "query", "key": "layout", "mode": "in-place" }` | Updates an app-owned query parameter |
| Hash | `{ "type": "hash", "mode": "navigate" }` | Updates an app-owned fragment |
| App API | See below | Reads and writes deeper app state through methods chosen by the author |

A boolean field needs a checkbox. A `checkboxGroup` field needs a multiple select. Buttons do not submit forms or follow unsafe, cross-origin or new-tab links. Password and file fields are unsupported. Style bindings take scalar values and must use a valid property.

Query/hash bindings explicitly choose `in-place` or `navigate`. The mode applies to edits, defaults and reset. In-place updates preserve history state without adding entries or reloading. Navigation stays in the same prototype/retained Build context. There is no direct pathname binding; use an app API for app-owned routing. Never bind the reserved `rc` or `rc.*` keys.

### App-owned APIs

For deeper state, expose your own object on `window`. The object name and method names are yours; there is no required Replica API name or framework adapter. For example:

```ts
window.catalogPreview = {
  readItems: () => catalogStore.items,
  writeItems: (items: number) => catalogStore.setItems(items),
  subscribeItems: (notify: () => void) => catalogStore.subscribe(notify),
  addItem: () => catalogStore.addItem(),
}
```

Declare the matching value binding:

```json
{
  "type": "api",
  "object": "catalogPreview",
  "read": "readItems",
  "write": "writeItems",
  "subscribe": "subscribeItems"
}
```

Read methods take no arguments and return the current value. Write methods take only the new value. Either may return a Promise; Replica uses settled readback and displays actual valid app values after rejection or clamping. Errors and bounded asynchronous timeouts are visible, not treated as success.

Choose notifications or periodic reads for each API value binding. A notification method accepts a callback and must return a cleanup function. Alternatively omit `subscribe` and set `pollMs`, an integer from 100 to 60000. Do not declare both. A button uses only `{ "type": "api", "object": "catalogPreview", "action": "addItem" }`; the method takes no arguments and needs no value notifications.

Object paths and method names are identifiers, not executable expressions. No eval, configurable method arguments, framework-internal state access or router detection is supported.

## Switch between app pages

Use an app API binding when a control should navigate between pages owned by the app's router. Give the options friendly values, then map each value to a route in the app. Keep the control in a shared set so it remains available while pages change; `role: "shared"` affects panel ordering and width, not route matching.

```json
{
  "version": 1,
  "sets": [
    {
      "version": 1,
      "scope": "navigation",
      "label": "Navigation",
      "role": "shared",
      "controls": [
        {
          "id": "page",
          "label": "Page",
          "type": "select",
          "default": "Organization",
          "options": ["Organization", "Enterprise"],
          "binding": {
            "type": "api",
            "object": "pageNavigation",
            "initial": "app",
            "read": "readPage",
            "write": "writePage",
            "subscribe": "subscribePage"
          }
        }
      ]
    }
  ]
}
```

`readPage` returns a declared option matching the current route. Define how the selector represents routes outside those options; an undeclared value produces a control error. `writePage` maps the selected option to its route and does nothing when that route is already current. `subscribePage` notifies Replica when the app's router changes and returns a cleanup function. Replace the example names with methods that use the app's existing router; do not read or change framework-internal state.

Define the page API once at module scope and register it from app startup code so it is available when Controls initializes. Keep that same object while pages change. If a page component replaces or removes the API object after a route change, Replica can no longer read the selected value back. It restores the previous control value and reports a binding error; it does not navigate the app back.

Leave the navigation set without a page `container` or a `when` condition on its selector. A page container can remove the selector during navigation; hiding a conditional control restores its default, which can navigate away from the current page.

Do not bind a page selector directly to `hash` or `query` navigation. Those bindings change URL strings rather than mapping friendly labels through the app's router. They can also carry a saved control override into another route, which can make Back or Reset return to the saved page.

### Startup and direct links

`initial: "app"` reads the current app value on startup without writing the JSON default, so a direct link to Enterprise stays on Enterprise. Replica never saves this control in `rc.*` and ignores legacy saved overrides for it. Back/Forward adopts the current route without writing a value. Edits and Reset all still call the write method; Reset all navigates to the declared default. The read method must return a declared value.

The option is only for API value bindings with a `read` method, not buttons. Ordinary API bindings keep their default-first behavior: a missing saved override writes the JSON `default` on initialization. Keep `writePage` idempotent either way.

`initial: "app"` requires Copilot plugin 1.10.1 or a Hub/Build capture runtime containing this option. Older runtimes reject the definition and show a Controls error while the ordinary app keeps working. The definition and Controls protocol versions remain `1`.

## Defaults, URLs and reset

Canvas and Hub persist ordinary overrides in prototype URLs as `rc.<scope>.<controlId>`. Missing overrides use JSON defaults. Edits use `replaceState`, preserving router-owned history state without reload or extra history entries. These settings never belong in a private renderer/proxy capability URL or review route.

Back/Forward restores the settings in that history entry. Invalid or duplicate overrides produce a visible notice; settings exceeding the 8 KB limit remain in memory with a saving error. Actions and results are never persisted. **Reset all controls** restores every set, including inactive sets, and removes overrides. Existing private Controls files are not read, migrated or deleted.

For a page selector, test a direct link to both the default and a non-default page without any `rc` override, app Back/Forward, and Reset all. With `initial: "app"`, the non-default link stays on its page and Reset all navigates to the default.

Definition edits need a page reload; there is no Replica file watcher or live schema replacement. After each edit, follow the skill's validate-and-reload loop, including worktree verification and runtime status. Missing definitions mean no Controls. Invalid/unsupported definitions show a local Controls error without breaking the ordinary app, and reject publication when present in the actual retained asset.

## Prove the effect

Check the repository's existing test/build commands and that the built asset is `/controls.replica.json`. Exercise each requested control's observable app effect, defaults and reset. Include distinct conditions, failures and page lifetimes where used; avoid redundant cases.

With authorized startup, follow the repository's browser validation workflow. Inspect the live page before interactions. Test the actual panel and app separately from JSON validation or jsdom evidence. Report blocked checks precisely rather than claiming a package installation or successful build proves rendered behavior.

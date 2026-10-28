# Minimal

A small React, TypeScript and Vite app with TanStack Router and no component library. It includes a start page, a linked sub-page and a seed-backed activity example. Replace the examples with your prototype.

Choose `--starter minimal` when creating a repository with Replica. Omitting the selection also chooses Minimal. See [prototype repository setup](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md) for installation.

The copied app includes [Replica setup and workflows](REPLICA.md) for canvas activation, Controls, optional product guidance and publishing. Follow the [app instructions](AGENTS.md) when editing code.

## Run it

Use an installed Node.js version matching `engines.node` in [package.json](package.json):

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. In Copilot, complete the [canvas preflight](REPLICA.md#canvas-preflight) before preview startup. Show the requested route before ordinary UI edits and keep the preview on that route.

## Validate changes

```sh
npm run typecheck
npm test
npm run build
npm run format:check
```

Use `npm run format` to format authored code. The production build is written to `dist`.

## Routing

Hashes beginning with `/`, such as `/#/activity`, identify prototype routes. Other fragments, such as `/#contents`, identify sections on the start page. A copied section link reopens the start page at that section rather than treating its ID as a missing route. Nested routes can include a section fragment, such as `/#/about#team`.

Existing prototypes can adopt `src/app/create-prototype-history/` and its use in `src/app/router.tsx` for section links in local and standalone previews. Hub review links do not require this update. Hub restores section fragments through its injected preview bridge without changing or rebuilding consumer source.

### Configure feedback for missing pages

Unknown prototype routes, such as `/#/not-built-yet`, display a shared "This page isn't built in the prototype yet" page. It is the root router's `notFoundComponent`, not a separate `/404` route, and works locally and in published previews.

Set `notFoundPageConfig.feedbackUrl` at the top of `src/app/not-found-page/index.tsx` to your team's Slack channel, GitHub Issues page or another feedback destination. Replace the included Replica Issues URL before sharing:

```ts
export const notFoundPageConfig = {
  feedbackUrl: "https://github.com/github/replica/issues",
}
```

With a URL configured, the page shows a primary **Give feedback** link in a new tab and a secondary **Back** button. Leave the URL empty to hide feedback and show a primary **Back** button with a secondary **Go to start** link instead. **Back** uses browser history; **Go to start** opens the prototype's `/` route, including when someone opens a missing page directly.

The page uses native HTML and a CSS module without adding a component library. Adapt `src/app/not-found-page/index.tsx` and its styles to your prototype's design system. Existing repositories must adopt the page, route adapter, styles and root-router registration themselves; updating Hub does not change a prototype's router.

## React organization

Route modules own loading and navigation. For example, `src/routes/home/home-route-page/index.tsx` passes a TanStack link to `home-page/index.tsx`, which renders a typed prop without importing the router. The activity loader assembles seed data, and `activity-route-page/index.tsx` passes it to `activity-page/index.tsx`.

Keep props in a colocated `types.ts` and styles beside the page. Use `@app/`, `@routes/` and `@data/` across top-level areas and relative imports within a route. TypeScript, Vite and Vitest share these aliases.

## Scaffold a route

The included scaffolder creates a raw JSON seed, loader, page, CSS module, lazy TanStack route and route wrapper:

```sh
npm run scaffold -- --slug roadmap --name "Roadmap"
```

The starter already includes `/activity`, so choose an unused slug. The `create-prototype` skill discovers this app's scaffold before building a new route. Existing pages are edited in place. The skill's product and design-system context requirements still apply.

The scaffold is configured by `prototype-scaffold.config.mjs`, with generated source templates in `scaffold-templates/neutral/`. These files belong to Minimal. The engine in `scripts/scaffold-prototype.mjs` validates input, protects against collisions and partial writes, updates metadata and selects already-bundled templates.

The registry must be under `src/app/`, and each generated route must be at `src/routes/<slug>/route.tsx`. The registry import defaults to `../routes/<slug>/route`; a consumer can specify `registry.importLine` for another import style, such as `@routes/<slug>/route`.

The generated import must retain a `<path>/<slug>/route` specifier so reruns and URL collision checks can find its route file. Each generated route must keep a single-line `path: "..."` property and exported `<camel>StartPage = "..."` metadata for safe reruns and collision checks. If the registry also contains inline routes, reserve their paths and slug/identifier pairs in the consumer config.

The configuration creates seven files: a seed, loader, `route.tsx`, `<slug>-page/index.tsx`, `<slug>-page/types.ts`, `<slug>-page/styles.module.css` and `<slug>-route-page/index.tsx`. It substitutes validated identifiers plus JSON-serialized seed and route values. Keep seed fields JSON-serialized instead of interpolating raw strings, so quotes and backslashes remain valid JSON.

Template CRLF line endings are normalized to LF before one-pass substitution without rewriting inserted values. Consumers can use the same file-reading substitution pattern:

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

`createFiles` receives `slug`, `name`, `description`, `startPage`, `scope`, `scopeConfig`, `routePath`, `pascal` and `camel`. It must create `src/routes/<slug>/route.tsx`, whose exported `<camel>StartPage` and `path` are used for safe reruns. Add a `prototype-templates.json` catalog only when you need `--template`; template selection verifies existing family files and never copies or overwrites them.

## Start page and guidance

Use `/#/route-name` for this app's hash routes, or `/` for its root. The scaffolder writes `.prototype` through the consumer's `resolvePrototypeStartPage` configuration; consumers without that function keep ordinary route paths. See [start-page behavior](REPLICA.md#set-the-start-page).

Minimal includes shared skills and research templates, not approved product or design-system context. Use `/setup-skills` when requested authoring needs that context. Review and separately approve drafts before activation. See [product guidance and skills](REPLICA.md#product-guidance-and-skills).

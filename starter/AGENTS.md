# Working on Minimal

Read the [shared Replica instructions](REPLICA-AGENTS.md) before prototype work. They own task scope, component preflight, canvas setup, publishing and browser validation. This file owns Minimal's app conventions.

## App and commands

Minimal uses React, TypeScript, Vite and TanStack Router with hash-based routes. It has no component library. Keep routing and scaffolding local to this app.

Use an installed Node.js version matching `engines.node` in [package.json](package.json):

```sh
npm ci
npm run dev
```

For checks, run `npm run typecheck`, `npm test`, `npm run build` and `npm run format:check`. Format authored code with `npm run format`: double quotes, no semicolons and trailing commas.

## Code

Prefer existing patterns, precise TypeScript types, explicit errors and tests beside the behavior they exercise. Route modules own loading and navigation. Route adapters pass typed props to presentation pages, which should not import the router. Place components in kebab-case directories with `index.tsx` and colocated `types.ts` and styles as needed. Use `@app/`, `@routes/` and `@data/` across top-level areas and relative imports within a route or component.

Read the [app guide](README.md) for routing and scaffold commands. The scaffold engine, configuration and `scaffold-templates/neutral/` belong to Minimal, not the shared Replica bundle.

## Product guidance

Minimal includes research templates, not approved product or design-system facts. When authoring work needs missing context, offer `/setup-skills`. Review and separately approve drafts before activation. No guidance setup is needed just to inspect the included app.

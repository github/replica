# Working on Shadcn

Read the [shared Replica instructions](REPLICA-AGENTS.md) before prototype work. They own scope, component preflight, canvas setup, publishing and browser validation. This file owns the app's conventions.

## App and commands

This is a React, TypeScript and Vite app using Tailwind CSS and project-local shadcn/ui sources. It uses Radix UI components and hash routes. The generated repository runs independently of Replica.

Use an installed Node.js version matching `engines.node` in [package.json](package.json):

```sh
npm ci
npm run dev
```

Open the URL Vite prints after completing the [canvas preflight](REPLICA.md#canvas-preflight). Run `npm run check:starter` for type checks, Vitest tests and a production build. Use `npm test -- src/app.test.tsx` for the app interaction tests.

## UI and routing

Load the installed [official shadcn skill](.agents/skills/shadcn/SKILL.md) before changing components or styling. Inspect `components.json` and the installed component source before using unfamiliar APIs. Reuse `src/components/ui/` and the official dashboard components rather than replacing them with styled native controls.

`src/app.tsx` owns the shell and `#/`, `#/records` and `#/settings` routes. Keep links hash-based and keep Vite's relative `base` so local previews and hosted Build subpaths work without server-side route rewrites.

`src/records-page.tsx` owns filtering and the detail dialog. `src/settings-page.tsx` owns the browser-local form and save feedback. `src/data/records.ts` contains fictional records. The dashboard's generated sample data lives in `src/app/dashboard/data.json`.

Use precise TypeScript types and the existing shadcn composition patterns. Keep app integration separate from generated UI primitives. Test behavior beside the feature using Vitest, jsdom and React Testing Library.

## Data and generation boundaries

Keep the example local and credential-free. Do not introduce a real backend, authentication or email delivery without an explicit request. Settings are saved only in browser storage, with successful and failed save feedback.

Creation installs UI sources and the official skill once. Do not add install, startup or build hooks that regenerate components, update skills or change the lockfile. Commit intentional component changes and the resulting lockfile. [The app guide](README.md#creation-and-upstream-inputs) explains the recipe, provenance and live upstream limitation.

The [active example context](.agents/context/REPOSITORY.md) describes only this starter. It does not define a consuming team's product policy. Use `/setup-skills` when new work needs missing product or design-system guidance; review drafts before activating them.

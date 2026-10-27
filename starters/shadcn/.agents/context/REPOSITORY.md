# Shadcn workspace repository

This context describes the included example, not a consuming team's product policy. Follow [app instructions](../../AGENTS.md), [shared Replica instructions](../../REPLICA-AGENTS.md) and the [official shadcn skill](../skills/shadcn/SKILL.md).

## Where UI lives

`src/app.tsx` owns the shell and hash routes. `src/records-page.tsx` and `src/settings-page.tsx` own the example flows. `src/components/` contains the official dashboard components and `src/components/ui/` contains installed shadcn primitives. `@/` resolves to `src/`.

## Commands

Use the runtime declared in [package.json](../../package.json). Run `npm ci`, then `npm run dev`. Open the URL Vite prints after the copied canvas preflight. Run `npm run check:starter` for type checks, interaction tests and a production build; `npm run preview` serves `dist`.

## Constraints

Keep hash routes and relative Vite assets for hosted Build previews. Keep records fictional and settings browser-local. The repository owns its generated UI sources and lockfiles; ordinary installation and startup must not regenerate them.

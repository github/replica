---
name: routing
description: 'React Router v7 routing conventions for this SPA. USE WHEN: editing `app/routes.ts`, adding/removing a route, or changing navigation.'
---

# Routing

Paths below are relative to `apps/prototype/`.

- This app disables runtime SSR (`ssr: false`) and renders routes client-side. React Router still generates the SPA HTML shell during the build.
- Routes are defined in `app/routes.ts` using React Router v7 config (the "framework" style).

## General Structure

- Main navigation structure:
  - Home: `index("routes/home.tsx")` at `/`
  - Discover section: `/discover/models`, `/discover/tools`
  - Build section: `/build/agents`, `/build/tools`
  - Operate section: `/operate/dashboard`, `/operate/agents`
  - Docs: `/docs`
- Layout wrapper: `components/shell/NavLayout.tsx` provides top/left nav
- Export `topNavRoutes` and `getLeftNavRoutes(pathname)` from `routes.ts` for navigation components
- Type-safe routes via auto-generated types in `.react-router/types/`

## Adding a Route

1. Create the file in `app/routes/`
2. Add it to `app/routes.ts` config array
3. Use type-safe route imports: `import type { Route } from "./+types/routeName"`
4. Run `react-router typegen` via `npm --workspace apps/prototype run type-check` from the repository root (or `npm run type-check` from the app directory) to regenerate types and check TypeScript

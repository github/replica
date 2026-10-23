# Hub coding conventions

Follow the [shared coding conventions](../../docs/coding-conventions.md) and the [code architecture conventions](backend-architecture.md) for repositories, integrations, utilities, and domains.

## TypeScript

- Use TypeScript for new application code and tests.
- Put each standalone function or component in a kebab-case directory with `index.ts` or `index.tsx`, colocated tests, types, and styles.
- Export at most one function per file and import exact directories rather than sibling-export barrels.
- Group package, alias, and relative imports separately.
- Use explicit `.ts` extensions for server imports so Node can run development source directly and the compiler can rewrite production imports.
- Keep HTTP parsing and responses outside domains. Validate input and return explicit errors when introducing real API behavior.

## Frontend layers

Application code imports Pages, Pages import Features, and Features import Components, hooks, and utilities. Imports must not point back up these layers. Keep presentation props typed and independent of a backend framework.

Preserve the existing `app/javascript/{application,pages,features,components,hooks,utils}/` layout. Keep page orchestration in application code rather than hiding requests or authorization inside presentation.

## Interface

- Use Primer Brand components and tokens first. Hub-owned styles use the semantic `--hub-*` mappings in `app/javascript/tokens/base.css`.
- When Brand lacks an app primitive, build a focused, accessible Hub-owned control instead of importing `@primer/react`.
- Keep `HubThemeProvider` around application and Storybook content so portals inherit the resolved theme.
- Use Storybook as the presentation workbench and add or update colocated stories for meaningful visual changes.
- Keep fixtures isolated from APIs and saved data. Preserve the canonical synthetic personas in the TypeScript fixture modules.
- Use mobile-first layouts, container queries when size depends on a component, and `rem` or `em` for type and related spacing.
- Leave blank lines between cohesive JSX and CSS groups. Follow the browser's system light or dark preference.

## Tests

Keep tests beside their TypeScript code. Use `describe("functionName()")` and plain-English cases. Keep fixtures and mutable state inside each case; use the global Vitest setup and configuration for shared environment cleanup and automatic mock resets.

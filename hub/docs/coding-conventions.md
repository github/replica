# Hub coding conventions

Follow the [shared coding conventions](../../docs/coding-conventions.md). This guide adds Hub's Rails, TypeScript, and interface rules.

## Rails

- Check Rails, Ruby, and existing repository helpers before adding custom token, validation, serialization, or lifecycle code. Use custom behavior when built-in utilities cannot meet requirements such as one-time use, revocation, digest-only storage, or database constraints.
- Models own product rules and state changes.
- Use `ActiveRecord::AssociatedObject` when related behavior belongs to a model but is too large to keep in the model file.
- Use `ActiveJob::Performs` when that behavior also needs to run as a background job.
- Keep GitHub, filesystem, and object-storage work outside transactions.
- Make cleanup explicit and enforce identity and state with database constraints.
- Controllers authenticate, load records through an authorized repository or Prototype, call one operation, and render.
- Split controllers when requests use different trust, credential, or authorization rules. Share only common request or response mechanics through a focused concern.
- Do not extract methods only to reduce a line count. Extract one complete responsibility.
- Prefer Rails resource routes and focused concerns over generic services or controller base classes.
- Prefer clear Active Record relations over inline SQL.
- Name operations for the result. `record!`, `create!`, or `remove!` are clearer than `process!`, `observe!`, or `manage!`.

## Ruby and Jbuilder

- For multiline calls, omit parentheses, place `\` after the method name, and put every argument on a following line.
- Inspect multiline calls yourself because RuboCop does not enforce this style.
- Use `to_i` for integer conversion, then validate the allowed range.
- Leave a blank line after a guard clause.
- Give every model method a short purpose comment.
- Elsewhere, comment only to explain policy or a decision the code does not make clear.

## TypeScript

```text
application
    |
    | imports
    v
pages
    |
    | imports
    v
features
    |
    | imports
    v
components, hooks, and utilities
```

- For example, a feature may import a component, but a component never imports a feature.
- Put each standalone function in a kebab-case directory with `index.ts` or `index.tsx`, its tests, types, and styles.
- Export at most one function per file and import exact directories.
- Do not create shared index files that only collect sibling exports.
- Keep `index.ts` focused on its function:
  - Put schemas and constants declared outside functions in `constants.ts` beside `index.ts`.
  - Put types declared outside functions in `types.ts` beside `index.ts`.
  - Keep values and types that depend on function arguments or type parameters inside that function.
  - Put constants shared by a domain in that domain's directory. Do not create a function directory just to hold constants.
- Rails TSX page views adapt Superglue data and browser workflows into their one presentation Page.
- Discover Rails TSX page views from their virtual paths instead of maintaining a parallel mapping.
- Group package, alias, and relative imports separately.

## Interface

- For Hub and canvas work, preserve existing feedback patterns. Flag perceived missing messages or interaction states in chat and ask before adding them; new success messages, banners, or notifications require explicit agreement. Keep required failure reporting explicit.
- Use Primer Brand components and Brand tokens first. Hub-owned styles use the semantic `--hub-*` mappings in `app/javascript/tokens/base.css`.
- When Brand lacks an app primitive, build a focused, accessible Hub-owned control instead of importing `@primer/react`.
- Use Storybook as the primary workbench for presentation changes.
- Keep page data and application hooks in Rails TSX page views so Pages accept typed presentation props.
- Add or update a colocated story with every meaningful visual change.
- Base story data on the canonical Oaken personas and cover empty, single-item, and multiple-item collections.
- Keep user-facing copy in focused locale files and pass it through page data.
- Use mobile-first layouts and container queries when size depends on the component.
- Use `rem` or `em` for type and related spacing.
- Leave blank lines between cohesive JSX and CSS groups.
- Follow the browser's system light or dark preference.

## Tests

- Keep tests beside TypeScript code.
- Use `describe("functionName()")` with plain-English cases.
- In TypeScript tests, create fixtures and mutable state inside each case. Avoid suite-level `beforeEach` and `afterEach`; keep shared environment cleanup in the global Vitest setup and use configuration for automatic mock and global resets.
- Put shared records in Oaken seed setup or scenarios, not `test_helper.rb`.

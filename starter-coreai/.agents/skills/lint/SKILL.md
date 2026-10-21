---
name: lint
description: 'Type-check and lint the CoreAI app. USE WHEN: the user asks to "lint", "fix lint", "run the linters", "check types", or after making code changes that need verification.'
---

# Lint the Codebase

Run checks from this app's directory. Fix errors caused by or directly related to the current task and report unrelated failures.

1. `npm run type-check` — Generate React Router types and check TypeScript.
2. `npm run lint` — Run ESLint. If editing components, invoke the `react-components` skill for guidance.

After fixing errors, rerun the affected command and inspect its result before claiming success. For CSS changes, follow the `css-styling` skill; these commands do not lint CSS.

## Related skills

- `css-styling` — required reading when fixing CSS warnings.
- `react-components` — required reading when fixing TSX warnings.

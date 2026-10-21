---
name: lint
description: 'Run the full lint workflow: format, typecheck, CSS lint, JS lint. USE WHEN: the user asks to "lint", "fix lint", "run the linters", "check types", or after making code changes that need verification.'
---

# Lint the Codebase

Run each step below in order from the repository root, fixing errors caused by or directly related to the current task before moving to the next step. Report unrelated pre-existing errors rather than changing unrelated code; do not claim a step passed while errors remain.

1. `npx prettier apps/prototype --write` — Auto-format prototype code with Prettier. For focused changes, pass explicit changed-file paths instead of the entire app directory. Run this first so formatting noise doesn't obscure real errors in later steps. Run periodically after editing TypeScript files. Do not use root `npm run format` for prototype-only work; it formats the entire repository.
2. `npm --workspace apps/prototype run type-check` — Generate React Router types and fix relevant TypeScript / JavaScript type errors.
3. `npm --workspace apps/prototype run lint` — Fix relevant ESLint issues in `.ts` and `.tsx` files. If editing components, invoke the `react-components` skill for guidance.

**Verification rule**: After fixing errors in a command-based step, re-run that step's command **standalone** (not chained with other commands or piped through `tail`). Read the **full output** and confirm the exact error/warning count before moving to the next step. Never trust truncated or chained output as proof of zero errors. For the manual CSS review step, recheck the affected CSS against the skill's checklist and retain the explicit automated-lint limitation.

Run `npx prettier apps/prototype --write` again when finished, or use the same explicit changed-file paths selected in step 1.

## Related skills

- `css-styling` — required reading when fixing CSS warnings.
- `react-components` — required reading when fixing TSX warnings.

# Coding conventions

Make the smallest complete change that gives the user or contributor the intended result. For example, when a new option changes saved data, include its failure behavior and tests rather than adding only the visible control.

These rules apply across Replica. Follow the affected project's guidance for its language, framework, file structure, and interface conventions.

## Make a complete change

- Keep related behavior together.
- Treat roughly 200 lines as a review signal, not a reason to split cohesive code.
- Inspect the closest existing code, test, and guide before adding a pattern.
- Complete access checks, persistence, failure behavior, UI, tests, and documentation for one user flow before starting another.
- Return explicit errors instead of empty results, broad catches, or success-shaped defaults.
- Inline a trivial one-use helper. Extract a reusable helper and test it through its public interface.
- Update the canonical guide when a product contract, architecture boundary, or operating rule changes.
- Leave unrelated work untouched.

For TypeScript modules, import the function or component directory without `/index.ts` or `/index.tsx` when the project's tools resolve directory imports. Native Node.js ES modules require explicit file paths; keep those paths in code run directly by Node.

## Tests

- Test behavior through public interfaces.
- Name cases in plain English for the result they demonstrate.
- Keep fixtures and mutable state inside each case so it reads from top to bottom.
- Use shared hooks for environment cleanup rather than hiding a case's setup.
- Keep test data local to one file unless several files truly share it.
- Check existing coverage before adding a case. Add only cases that prove distinct behavior, using the smallest set needed for confidence.

## Comments and copy

- Comment when the reason for a rule or decision is not clear from the code. Do not restate what the code does.
- Use the [documentation conventions](documentation-conventions.md) for prose, comments, labels, and errors.
- Never commit secrets, tokens, private keys, or real private repository data.

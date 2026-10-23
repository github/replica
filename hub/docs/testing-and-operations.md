# Hub testing and operations

The new Hub has no deployment setup, database, sign-in, or product APIs yet. These checks cover the new app setup and the frontend code we kept. They do not prove that the old Hub's features work.

Run commands directly from `hub/` after `npm ci`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run storybook:build
```

Vitest uses a Node project for API and pure utility tests and a jsdom project for frontend behavior. A focused API check is `npm test -- --project=node server/create-app/index.test.ts`. HTTP tests listen on ephemeral loopback ports and close their servers afterward.

The API health check proves only that Express responds. Routes that have not been built must return 404 rather than pretending to work.

## Shared code

The extension and build action still use Hub's Controls and canvas code. Keep their checks working:

```sh
npm run controls:runtime:test
npm run controls:schema:check
npm run controls:assets:check
npm run controls:test
npm run extension:assets:check
npm run extension:test
```

Schema changes require `npm run controls:schema:generate`. Source changes that affect generated assets require `npm run controls:build` and `npm run extension:build`, followed by the freshness checks.

## Review

Follow the [shared testing guide](../../docs/testing-and-review.md), the [Storybook screenshot requirements](storybook.md#ui-changes-and-pull-request-evidence), and the root browser workflow. Run `hub/bin/review-prose` from the repository root to inspect changed prose across all projects, then `git diff --check`.

Dependency resolution retains the committed seven-day npm release-age delay. See the [shared dependency policy](../../docs/testing-and-review.md#update-dependencies) for repository-level checks.

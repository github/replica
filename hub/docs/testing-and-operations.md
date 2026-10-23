# Hub testing and operations

The new Hub has a PostgreSQL and Prisma foundation but no product models, deployment setup, sign-in, or product APIs yet. These checks cover the new app setup and the frontend code we kept. They do not prove that the old Hub's features work.

Run commands directly from `hub/` after `npm ci`. The database command also needs PostgreSQL and `TEST_DATABASE_URL`, as described in [parallel database tests](#parallel-database-tests):

```sh
npm run lint
npm run db:validate
npm run typecheck
npm test
npm run test:database
npm run build
npm run storybook:build
```

`npm test` selects the Node project for API and pure utility tests and the jsdom project for frontend behavior. Neither requires PostgreSQL. A focused API check is `npm test -- server/create-app/index.test.ts`. HTTP tests listen on ephemeral loopback ports and close their servers afterward.

The API health check proves only that Express responds. Routes that have not been built must return 404 rather than pretending to work.

Installation generates Prisma Client without a database connection. Client lifecycle tests cover reuse across development reloads, production global behavior, and missing configuration.

## Clean test cases

[The shared setup](../test/setup.ts) and Vitest configuration reset mocks, spies, stubbed globals, stubbed environment variables, fake timers, and the module cache before every case. The browser setup also clears storage, navigation state, selections, and leftover document content. React Testing Library unmounts rendered components after cases.

Arrange each case's inputs and records inside that case, act through its public interface, and assert the result. Do not depend on records, mocks, or effects left by another case. Use `beforeEach` only for repeated setup, not to hide a case's important inputs. Avoid local `afterEach` and `afterAll` for state already reset globally.

Global resets cannot dispose arbitrary servers, files, sockets, or event listeners. Release resources owned by a case with `try/finally` or Vitest's `onTestFinished`, registered when creating the resource. Module-cache resets affect subsequent imports, not references already imported by a test file; reset any deliberately shared fixture state before each case.

## Parallel database tests

Vitest runs files in parallel with its [default forked-process pool](https://vitest.dev/config/pool). The configuration makes this explicit and keeps cases within a worker sequential, including cases marked concurrent, because resetting a shared worker database while another case runs would erase its records. `--maxWorkers` controls file-level parallelism.

Only `npm run test:database` selects the database-enabled server project. Name those tests `server/**/*.db.test.ts`; they are excluded from the ordinary Node project. Use the PostgreSQL service in [Development](development.md) and set `TEST_DATABASE_URL` from `.env.example`. The devcontainer supplies its internal service URL. The database user needs permission to create and drop databases; use a local development service, not a production connection.

Before workers start, global setup creates a run-unique template database and applies the current Prisma schema with `prisma db push`. It clones that template for every worker slot. Setup uses Vitest's [documented `VITEST_POOL_ID`](https://vitest.dev/guide/migration/jest#envs), which stays within the configured worker limit, rather than the ever-increasing worker instance ID. Each worker receives its own `DATABASE_URL` before application modules load.

Before every case, the database setup truncates application tables across user schemas and restarts their identities. It preserves Prisma's migration records. Tests create their own records in an arrange, act, assert pattern; there is no shared seed data. At the end of the run, global teardown drops only the databases it created, even if tests left connections open. Unique run prefixes also isolate simultaneous Vitest runs. Cleanup rejects database names outside the test namespace and verifies the actual connected database before truncating.

The test helpers under `test/` are test infrastructure, not application repositories, integrations, utilities, or domains. Runtime code must not import them. These helpers use direct PostgreSQL access to prepare databases before Prisma Client and application code load.

Hub CI runs this project against PostgreSQL on every supported Node major. Only that matrix command starts the database service; browser, pure unit, formatting, and build checks do not require it.

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

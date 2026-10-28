# Hub testing and operations

These checks cover the Hub API, database setup, and frontend. See [Architecture](architecture.md) for the features that are implemented.

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

`npm test` runs API and utility tests in Node.js and frontend tests in jsdom, which provides a browser-like environment. Neither requires PostgreSQL. To run a focused API check, use `npm test -- server/create-app/index.test.ts`. HTTP tests listen on temporary loopback ports and close their servers afterward.

The API health check proves only that Express responds. Authentication route tests inject provider clients and identity services; they never require live GitHub credentials or make real GitHub requests. Routes that have not been built must return 404 rather than pretending to work.

Installation generates Prisma Client without a database connection. Client tests check reuse across development reloads, production behavior, and errors for missing configuration.

## Clean test cases

[The shared setup](../test/setup.ts) and Vitest configuration reset test state before every case:

- Reset mocks and restore spies, stubbed globals, and stubbed environment variables.
- Restore real timers and clear the module cache.
- Clear browser storage, navigation state, selections, and leftover document content.

React Testing Library also unmounts rendered components after cases.

Arrange each case's inputs and records inside that case. Act through its public interface, then assert the result. Do not depend on records, mocks, or effects left by another case. Use `beforeEach` only for repeated setup, not to hide a case's important inputs. Avoid local `afterEach` and `afterAll` for state already reset globally.

Tests must release resources they create, such as servers, files, sockets, and event listeners. Use `try/finally` or register disposal with Vitest's `onTestFinished` when creating the resource. Clearing the module cache only affects subsequent imports. Reset any deliberately shared fixture state before each case.

Keep project-wide test helpers in the appropriate `test/` directory and function-specific helpers beside their owning function. TypeScript checks both, but the API build excludes them.

## Parallel database tests

Each test run uses separate databases so parallel tests cannot change another worker's records or clear the development database. Vitest runs files in parallel in [forked worker processes](https://vitest.dev/config/pool). Cases within a worker run sequentially, including cases marked concurrent, so database resets cannot erase another case's records. Use `--maxWorkers` to set file-level parallelism.

Execution environment and database access are separate choices:

| Environment | Without PostgreSQL | With PostgreSQL    |
| ----------- | ------------------ | ------------------ |
| Node.js     | `node`             | `node-database`    |
| jsdom       | `browser`          | `browser-database` |

Use `.test.ts` or `.test.tsx` for ordinary cases. Use `.db.test.ts` or `.db.test.tsx` to opt into database access. Server and test-infrastructure files run in Node.js. Frontend and Storybook files run in jsdom, except the utility cases listed in `vitest.config.ts` for Node.js. Each file runs in exactly one project.

`npm test` selects `node` and `browser` without requiring PostgreSQL. `npm run test:database` selects both database-enabled projects. To select one project, run `npx vitest run --project=node-database --passWithNoTests` or use `--project=browser-database` instead.

Start the PostgreSQL service as described in [Development](development.md) and set `TEST_DATABASE_URL` using `.env.example`. The devcontainer supplies this variable. Use a local database user with permission to create and drop databases, never a production connection.

The database command uses `--passWithNoTests` so an empty selection exits successfully. It still fails when tests fail. Identity repository cases exercise external identity linking and uniqueness, installation membership, provider-aware one-use attempts, session context, GitHub integration credential independence, transaction rollback, and concurrent store locks. Authentication and administration cases also cover PKCE, browser binding, provider revisions, invitation activation, one-use bootstrap and recovery boundaries, last-administrator races, targeted session revocation, admission-policy separation, secure cookies, CSRF and origin checks, log omission, and transient GitHub user tokens. Job integration cases exercise real PostgreSQL queues, schedules, and database resets.

A dedicated migration case applies the foundation migration, seeds retained lifecycle and security records, then applies the next migration. This catches upgrade behavior that an empty final schema cannot prove, including audit-outcome backfills and lifecycle constraints.

Prototype authorization cases cover direct-rule precedence, explicit deny, no-access defaults, GitHub baseline mapping and staleness, prototype-specific restrictions, cross-prototype and cross-repository isolation, installation membership versus product authority, stale sessions, deterministic overlapping administrator changes, membership lifecycle conflicts, audit rollback, route enforcement, scalar list responses, deny-aware and terminal pagination, version ownership, workload credential revocation, publisher suspension, provisioning authority, lock-free metadata reads, archive lifecycle, and explainable decisions. Artifact publishing cases cover manifest bounds, credential-free provenance URLs, digest and size verification, scoped workload actions, token non-storage, idempotent replay and conflicts, status isolation, concurrent sequence assignment, immutable rows, atomic publish-and-promotion, promotion rollback and replay, revocation and disable races, cross-prototype isolation, audit rollback, body limits, request-log omission, and the local non-GitHub producer contract. Local storage cases reject relative and symbolic-link paths and cover durable directory synchronization.

GitHub synchronization cases use mocked GitHub API responses and real database transactions. They cover transactional cache revalidation, invitation precedence during source outage, immutable-ID rename and 404 invalidation, token-404 installation removal, credential-independent webhook revocation, retryable source-generation changes, per-result confirmation ordering, active-identity filtering, bounded provider requests and apply batches, partial scans, dirty-event retry coalescing, first-enrollment and admission-failure auditing, repository and installation lifecycle, provider-response versus apply failures, scheduled failure logging, stale per-user and overlapping reconciliation or sign-in, manual suspension and audited administration preservation, compatibility membership isolation, synchronized session freshness, and rollback.

The API starts reconciliation every 15 minutes and operators can trigger one repository immediately through the administration API. A source stores `dirty`, `current`, `failed`, or `removed`, its last attempt and confirmation, and a bounded error code. Provider failures leave the prior confirmation unchanged. Access fails closed after the one-day last-known-good window, even if no webhook reported the change. Monitor repeated `failed` states and stale confirmations; do not extend the window to hide an outage.

The reference artifact adapter stores content-addressed files under `HUB_ARTIFACT_STORAGE_PATH`. Give the test process a temporary absolute directory. Production deployments must mount durable storage and monitor capacity; the reference adapter has no replication or automatic garbage collection. Before deleting an unreferenced file, confirm that no `PrototypeVersion.storageKey` points to it and that no publish transaction or backup can still require it.

Database-enabled jsdom tests use the browser setup and database hooks together. They can arrange records through server code, but frontend code must not import server modules. The setup does not start an API or connect frontend requests to one.

The database setup follows this lifecycle:

1. Before workers start, setup creates a template database with a unique name for each project and run. It applies committed Prisma migrations with `prisma migrate deploy` and BullMQ's migrations, closes those setup connections, then copies the template for every worker slot.
2. Each worker receives its own `DATABASE_URL` before application modules load. Setup uses Vitest's [`VITEST_POOL_ID`](https://vitest.dev/guide/migration/jest#envs), which stays within the configured worker limit.
3. Before every case, setup empties application and job tables across user schemas. It preserves `public._prisma_migrations` and `bullmq.migration`. Each case creates its own records; there is no shared seed data.
4. After the run, teardown drops only the databases it created, even if tests left connections open.

Unique database names also isolate simultaneous runs. Before clearing tables, cleanup checks that the database name belongs to the test namespace and matches the connected database.

The helpers under `test/` prepare databases before Prisma Client and application code load. They are test infrastructure, not application repositories, integrations, utilities, or domains. Runtime code must not import them.

Hub CI runs database tests against PostgreSQL on every supported Node major. Only that command starts the database service.

Job tests use each worker's resolved `DATABASE_URL`, never `TEST_DATABASE_URL`. Close their consumers, queues, and owned connections before the next case's reset; clearing the module cache does not stop running jobs. See [Background jobs](background-jobs.md#tests) for job-specific lifecycle rules.

Use `test/database/get-database-url` to read the worker URL and `test/jobs/open-queue` for a queue that closes at test completion. Tests that reset data mid-case must create and close their queues explicitly before resetting.

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

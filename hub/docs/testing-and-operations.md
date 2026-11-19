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

The API health check proves only that Express responds. Product API routes that have not been built must return 404 rather than pretending to work.

Run `npm run image:check` with a Docker-compatible daemon to build the production image and exercise role provisioning, repeated setup, runtime data access and denied schema changes, queue processing, readiness, serving, and shutdown against disposable PostgreSQL. It creates uniquely named resources and removes them afterward. The image compiles the Hub runtime only; the normal `build` command also checks the frontend, test tooling, and shared extension.

The image smoke test waits for PostgreSQL's TCP listener. Its temporary initialization server accepts Unix-socket connections before the database is ready for connections from other containers.

Installation generates Prisma Client without a database connection. Client tests check reuse across development reloads, production behavior, and errors for missing configuration.

## Clean test cases

[The shared setup](../test/setup.ts) and Vitest configuration reset test state before every case:

- Reset mocks and restore spies, stubbed globals, and stubbed environment variables.
- Restore real timers and clear the module cache.
- Clear browser storage, navigation state, selections, and leftover document content.

React Testing Library also unmounts rendered components after cases.

Arrange each case's inputs and records inside that case. Act through its public interface, then assert the result. Do not depend on records, mocks, or effects left by another case. Use `beforeEach` only for repeated setup, not to hide a case's important inputs. Avoid local `afterEach` and `afterAll` for state already reset globally.

Tests must release resources they create, such as servers, files, sockets, and event listeners. Use `try/finally` or register disposal with Vitest's `onTestFinished` when creating the resource. Clearing the module cache only affects subsequent imports. Reset any deliberately shared fixture state before each case.

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

The database command uses `--passWithNoTests` so an empty selection exits successfully. It still fails when tests fail. The job integration cases exercise real PostgreSQL queues, schedules, and database resets.

Database-enabled jsdom tests use the browser setup and database hooks together. They can arrange records through server code, but frontend code must not import server modules. The setup does not start an API or connect frontend requests to one.

The database setup follows this lifecycle:

1. Before workers start, setup creates a template database with a unique name for each project and run. It deploys the committed Prisma migrations and BullMQ's migrations, closes those setup connections, then copies the template for every worker slot.
2. Each worker receives its own `DATABASE_URL` before application modules load. Setup uses Vitest's [`VITEST_POOL_ID`](https://vitest.dev/guide/migration/jest#envs), which stays within the configured worker limit.
3. Before every case, setup empties application and job tables across user schemas and resets generated identity counters. It preserves `public._prisma_migrations` and `bullmq.migration`. Each case creates its own records; there is no shared seed data.
4. After the run, teardown drops only the databases it created, even if tests left connections open.

Unique database names also isolate simultaneous runs. Before clearing tables, cleanup checks that the database name belongs to the test namespace and matches the connected database.

The helpers under `test/` prepare databases before Prisma Client and application code load. They are test infrastructure, not application repositories, integrations, utilities, or domains. Runtime code must not import them.

Hub CI runs database tests against PostgreSQL on every supported Node major. Only that command starts the database service.

Job tests use each worker's resolved `DATABASE_URL`, never `TEST_DATABASE_URL`. Close their consumers, queues, and owned connections before the next case's reset; clearing the module cache does not stop running jobs. See [Background jobs](background-jobs.md#tests) for job-specific lifecycle rules.

Use `test/database/get-database-url` to read the worker URL and `test/jobs/open-queue` for a queue that closes at test completion. Tests that reset data mid-case must create and close their queues explicitly before resetting.

## Local browser smoke test

### Click through the real Hub

Use the seeded smoke workspace to test the real React Router app, Express API, and PostgreSQL on Linux. It has a successful Build with a preview, an unbuilt prototype, an unlisted draft, and a saved template. It does not need a GitHub App, external credentials, or a Docker Build. Local-mode preparation uses the [Build action's Playwright and Chromium](development.md#build-local-prototype-repositories).

From `hub/`, after `npm ci`, use a loopback PostgreSQL server with a test user that can create and drop databases. For the standard development Compose database:

```sh
docker compose -f .devcontainer/compose.yaml up -d --wait db
export TEST_DATABASE_URL=postgresql://replica:replica@127.0.0.1:5432/postgres
npm run build:runtime
npm run smoke:local
```

If that database is already running, skip the Compose command. Use the `http://localhost:…` URL printed by the smoke command, then choose **Sign in as local developer**. The repository picker should show `local/validation`. If you see the **Test data** toolbar, you are on the mock site, not this server.

The command does not need a `.env` file and does not use your development database or existing prototype checkout. Keep the terminal open while testing. Press **Ctrl+C** to stop Hub and discard the temporary database and artifacts; rerun `npm run smoke:local` to start fresh. Keep the server on loopback.

| Try this | Pass if |
| --- | --- |
| **Prototypes**: Open the **Welcome** prototype, dismiss its introduction, and open **More actions → History**. Go back and open **No Build**. | Welcome opens the saved Build 1 and has a history entry. No Build shows **No preview available**. |
| **Edit prototype listings**: Add `prototype/listing-draft` as **Smoke draft**. Go back to the gallery, reload, and open the repository's **Security audit**. | Smoke draft stays in the gallery and the repository audit shows `prototype.registered`. Registering did not create a Build. |
| **Create**: Open **Field notes**, choose **Branch from here**, enter “Add a trail map,” and select **Copy prompt**. Paste into a local text editor. | The saved template still opens even though the next default-branch Build failed. The copied prompt contains the brief and `/field-notes/`. Hub does not create a branch. |
| **Review**: Open the Welcome prototype. Choose **Add a comment → Comment on element**, click **Example action** inside the preview, and post a comment. Add a reply and an emoji reaction, then reload. Use the root comment's actions menu to **Mark as unread**. Resolve the thread, then use **Show resolved** in the comments filters to reopen it. | The thread, reply, and reaction persist across reload. The unread state changes independently of resolution; reopening makes replies available again. |
| **Welcome** in the sidebar: Copy its page URL, select **Hide welcome**, and reopen the saved URL. | Welcome stays off the sidebar after reload. The direct page still opens. |
| **Analytics**: Add a **Segment** destination with a throwaway key such as `smoke-only-not-a-real-key`. Reload, pause, resume, and disconnect it. | The destination persists, shows no saved key, and disappears after disconnect. The page reports that outbound analytics delivery is disabled. |
| **Public sharing**: Confirm and enable it, then open the Welcome prototype's **More actions → Share links**. Create a Build 1 link and paste it into a private browser window. Delete the link from Hub and reload the private window. | Before revocation, the signed-out window shows just the preview. After revocation, it shows **This link was revoked** and no preview. |

Also open **Inbox**, **Canvas connections**, and **Hub administrators**. The workspace uses one real local identity, so Inbox and Canvas connections start empty. To check live review updates, open the same comment thread in two tabs and post a reply from one; the other should update without a reload. For a final administrator check, also sign in from a separate browser profile, then confirm **End all Hub sessions**. Both browser sessions should require sign-in again on reload.

This smoke workspace seeds saved files, not a Git history. Check Git discovery and packaging separately with [local Builds](development.md#build-local-prototype-repositories). Check [Canvas approval and revocation](prototype-canvas.md#connect-and-revoke) from the actual extension with a matching checkout and a local development Hub. Use an approved scratch GitHub App and repository in [`dev:api:live`](development.md#start-with-the-real-api) for hosted Build import, repository roles, and cross-user mentions and Inbox. Real analytics delivery and deployed sharing are separate checks; leave them off for this walkthrough.

### Run the automated check

Run this check on Linux with `playwright-cli` and its Chromium browser installed. Point `TEST_DATABASE_URL` at a disposable PostgreSQL server on loopback with permission to create and drop databases. From `hub/`:

```sh
npm run build:runtime
npm run test:local
```

The test starts the built client and Express on one loopback port with an isolated PostgreSQL worker database. It signs in as the fixed local administrator, registers a draft, and verifies its gallery listing and audit record. It hides **Welcome** and revisits the direct page, opens a named template from the latest successful default-branch Build, and copies a prompt including the current preview route. It opens **Canvas connections** and exercises public sharing in a second signed-out browser context. Reloading after revocation must no longer open the preview. No `.env` or external account is needed. The test removes its database, private storage, and browser session.

The test seeds a small SQL fixture and saved preview bytes, not a Git history. Use the [local Build workflow](development.md#build-local-prototype-repositories) to check Git discovery, Build execution, screenshot capture, and packaging separately. Use the [mock frontend](frontend.md#start-with-mock-data) to explore slow or failing responses, not as evidence that the real API persists changes.

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

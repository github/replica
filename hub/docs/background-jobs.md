# Background jobs

Hub uses BullMQ's PostgreSQL backend for internal background work. The foundation provides queues, validated job payloads, recurring schedules, and independent worker commands. No product jobs or production schedules are registered yet. The Rails jobs have not been ported.

## Queues and workers

Two stable queue names separate execution capacity:

| Queue | Work | Command from `hub/` |
| --- | --- | --- |
| `on-demand` | Work requested by an application action | `npm run worker:on-demand` |
| `scheduled` | Recurring work and work spawned by recurring sweeps | `npm run worker:scheduled` |

Each command starts one Node.js process consuming only its assigned queue. The API starts neither worker. Multiple processes may consume the same queue when more capacity is needed. Separate queues do not isolate PostgreSQL, CPU, or external service quotas.

`ON_DEMAND_JOB_CONCURRENCY` and `SCHEDULED_JOB_CONCURRENCY` independently set the number of active jobs per worker process. Both default to one and accept integers from 1 through 100. CPU-heavy JavaScript still blocks that worker's event loop; move that work to a subprocess or an appropriate execution boundary when adding the domain.

`server/workers/configuration.ts` is the composition point for processors and schedules. Its empty registrations are intentional until product domains exist. Worker startup logs readiness after connecting; unknown job names fail permanently rather than disappearing.

Workers stop accepting work on `SIGINT` or `SIGTERM` and wait for active jobs. After 30 seconds, the command exits unsuccessfully rather than waiting forever. Interrupted work can be retried by BullMQ's stalled-job recovery. Deployment stop timeouts must allow this shutdown window. Long-running domain work needs its own bounded execution and interruption policy; a queue lock is not a business lock.

## Database and setup

Jobs use `DATABASE_URL`, the same database as application data, with BullMQ-owned tables and functions in the `bullmq` schema. Prisma owns only the application schema. Do not copy BullMQ tables into Prisma models or change its migration files.

From `hub/`, after installing dependencies and starting PostgreSQL:

```sh
npm run setup
```

This runs `prisma migrate deploy`, then BullMQ migrations, then schedule registration. A failed step stops setup. For local work that only needs the job schema, use `npm run jobs:setup`.

Run setup once as a coordinated release step before starting the new application version. Do not run it in every API or worker startup. Migrations are not one transaction across Prisma and BullMQ, and changes must remain compatible with old processes during a rolling upgrade. BullMQ schema downgrades are not supported.

After building, the compiled equivalents are:

```sh
npm run start:setup
npm start
npm run start:worker:on-demand
npm run start:worker:scheduled
```

Run the last three commands as separate services, not sequential commands in one shell. These roles can use one application image in a future Compose deployment, with PostgreSQL shared and only the web service exposed. Production frontend hosting, an application image, service health checks, and release orchestration are not implemented by this foundation.

Each queue or worker owns a small query pool and BullMQ's additional notification connections. The query pool is limited to two connections; concurrency does not increase that limit. Budget database connections across all API, producer, and worker instances. Creation functions require an explicit URL so tests and other callers cannot accidentally inherit a previously imported database client.

## Defining work

Keep stable names, a Zod payload schema, and retry options in a job definition. Producers need the definition, not the domain's execution code. Register a processor at the worker composition point using `createJobProcessor(definition, process, shouldRetry)`. The optional `shouldRetry(error)` predicate makes an execution failure permanent when it returns false; errors otherwise follow the job's retry options.

Use the functions under `server/integrations/bullmq/`:

| Function | Contract |
| --- | --- |
| `migrateJobDatabase(databaseUrl)` | Explicitly migrate BullMQ's schema and close the migration connection. |
| `createJobQueue(options)` | Open a client for one named PostgreSQL queue. The caller must close it. |
| `enqueueJob(queue, definition, payload, options)` | Validate JSON payload data and enqueue work with job-specific retries and optional delay, priority, or job ID. Failure rejects the call. |
| `createJobProcessor(definition, process, shouldRetry)` | Bind typed execution to runtime payload validation. Invalid stored payloads fail permanently. |
| `createJobWorker(options)` | Construct a stopped consumer for registered processors. The caller starts and closes it. Duplicate processor names are rejected. |
| `upsertJobSchedule(queue, schedule)` | Validate and register an interval or timezone-explicit cron schedule on `scheduled`. |

`runJobWorker()` owns process signals and consumer lifetime outside the integration. Integration code does not import domains, repositories, or the shared logger; worker composition injects processors and logging.

Payloads must serialize as JSON. Prefer record IDs and necessary revision identifiers over snapshots, credentials, or private text. Load current records and recheck access when execution begins. Do not rely on TypeScript alone: enqueue and execution both validate input.

Retries default to one attempt. A definition can specify `attempts`, `backoff`, and `priority`; an enqueue can override priority. Choose retries according to the operation, not a universal policy. Retention keeps at most 1,000 successful jobs for up to one day and 5,000 failed jobs for up to seven days. BullMQ applies removal lazily as jobs finish, not as a strict expiry timer. Job records can retain payloads and failure messages, so restrict database access and keep secrets out of thrown errors as well as payloads.

Worker logs contain queue, job name, job ID, attempt counts, and error types, never payloads, results, or raw exception messages. Domain functions should report safe failure codes and necessary context through the existing logging policy. Connection failures and command failures produce explicit error records.

## Schedules and delivery guarantees

A schedule has a stable ID within a stable queue. Setup calls `upsertJobSchedule()` with that identity, so repeated releases update one schedule instead of adding another. Removing an entry from code does not remove its persisted schedule: explicitly call BullMQ's `removeJobScheduler()` when retiring or renaming one. Coordinate updates through one release step so old and new processes do not overwrite each other's definitions.

Keep work spawned by a recurring sweep on `scheduled`; otherwise a sweep can consume on-demand capacity indirectly. Scheduled times are not execution deadlines, and a busy queue can run less often than its configured interval. Define missed-run and overlap rules when each domain is introduced.

Assume at-least-once execution. A stable job or scheduler ID does not replace idempotent handlers or keyed exclusion across workers and queues. Sharing PostgreSQL also does not make a Prisma write and a BullMQ enqueue atomic. Future domains that need guaranteed submission must explicitly implement an outbox or another durable recovery contract.

## Tests

Ordinary `npm test` requires no database. Use `.db.test.ts` cases and `npm run test:database` for real BullMQ behavior. The [database harness](testing-and-operations.md#parallel-database-tests) applies Prisma and BullMQ setup to a unique template before cloning a database for each Vitest worker.

Pass the current worker's resolved `DATABASE_URL` to every queue and consumer. Do not use the administrative `TEST_DATABASE_URL` or a production connection. Each test registers its own synthetic processors and schedules; setup does not install production schedules.

Close consumers, queue clients, and any owned connections before the next case resets data. Clearing Vitest's module cache does not stop consumers. Cleanup clears job and schedule tables but preserves `public._prisma_migrations` and `bullmq.migration`; preserving a migration ledger is not preserving queued work.

## References

- [BullMQ PostgreSQL backend](https://docs.bullmq.io/guide/postgresql)
- [Job Schedulers](https://docs.bullmq.io/guide/job-schedulers)
- [Managing schedules](https://docs.bullmq.io/guide/job-schedulers/manage-job-schedulers)
- [Worker shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)

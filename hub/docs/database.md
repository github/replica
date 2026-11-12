# Hub database

Hub uses PostgreSQL and Prisma.

[Background jobs](background-jobs.md) use the same database with BullMQ-owned tables and functions in the `bullmq` schema. Prisma does not own those objects. `npm run setup` applies Prisma migrations before BullMQ setup and schedule registration.

[Compose](../.devcontainer/compose.yaml) pins the development database image. [package.json](../package.json) pins the Prisma packages to the same version. Dependency updates must follow the [seven-day dependency policy](../../docs/testing-and-review.md#update-dependencies).

Hub requires PostgreSQL 17 or newer. Choose a stable supported major available from both Azure Database for PostgreSQL and Amazon RDS or Aurora. Managed services can offer different patch releases; the local image may track a newer stable major than the reference deployment. Check provider availability and the Hub test matrix before changing the minimum or the local major.

## Schema conventions

[prisma7.config.ts](../prisma7.config.ts) loads the entire `schema/` directory. Organize schema files as follows:

- Keep the generator and datasource in `schema/schema.prisma`.
- Put each model in a kebab-case `.prisma` file and each enum in a kebab-case `.enum.prisma` file.
- Store migrations in `schema/migrations/` and commit them with their schema changes.

Assign schema and enum values to the earliest accepted stack layer that needs them, including an imminent dependent layer with an agreed contract. Do not add speculative product values without an accepted consumer.

Use singular PascalCase model and enum names. Follow these field and table conventions:

- Map every model to a plural `snake_case` table with `@@map`.
- Use camelCase Prisma fields. Map database columns to `snake_case` with `@map` when their names differ, including foreign keys.
- Give every table a UUID `id` primary key and `created_at` and `updated_at` timestamp columns.
- Use PostgreSQL's native UUID type for primary and foreign keys.

Order each model's sections as ID columns, relations, attribute columns, and timestamp columns. Put the table mapping last. Keep comments for sections that are present. This example shows the required structure; it does not define a product model:

```prisma
model Folder {
  // ID columns
  id       String  @id @default(uuid()) @db.Uuid
  parentId String? @map("parent_id") @db.Uuid

  // Relations
  parent   Folder?  @relation("FolderTree", fields: [parentId], references: [id])
  children Folder[] @relation("FolderTree")

  // Attribute columns
  name String

  // Timestamp columns
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("folders")
}
```

`uuid()` generates UUIDs through Prisma. `@updatedAt` updates timestamps on Prisma writes, not through a database trigger. Raw SQL writers must supply UUIDs and maintain `updated_at` themselves. Use timezone-aware timestamps for stored instants.

## Shared client

Import `prisma` from `server/integrations/prisma/index.ts` rather than constructing clients in each caller. The integration uses Prisma's [documented global cache pattern](https://www.prisma.io/docs/orm/v7/more/troubleshooting/nextjs#avoiding-multiple-prisma-client-instances) to reuse one client across development module reloads. Production uses the module instance without setting the global variable.

The integration requires `DATABASE_URL` and reads `.env` when present. Do not import server database code into the frontend. Keep queries in repositories and follow the [import boundaries](backend-architecture.md#import-boundaries). Domains may pass the shared client into repository functions; repositories must not import integrations directly.

## Schema changes

Run these commands from `hub/`:

```sh
npm run db:validate
npm run db:migrate -- --name describe_the_change
npm run db:generate
```

`npm ci` also generates the client. Generated TypeScript lives under the ignored `server/generated/prisma/` directory and compiles with the API. Schema validation and generation do not require a running database or `DATABASE_URL`; migration and database commands require both. Generate again after changing a schema.

Use `db:migrate` only with a local development database. It needs permission to create a shadow database to calculate migrations. `npm run db:deploy` applies committed migrations without creating new ones; database tests use this command so constraints in committed migrations are exercised. It is not a production deployment setup. `npm run db:studio` opens Prisma's database editor and should be used only with an intended development database.

Prefer idiomatic Prisma operations for ordinary create, read, update, and delete behavior. Use raw SQL only for a named semantic Prisma cannot express, such as row locks, `SKIP LOCKED`, atomic returning behavior, partial-index behavior, or database-owned time. Cover that semantic with a focused PostgreSQL test.

Keep ordinary value and shape validation in application code. Add a database guard only for a named cross-writer, concurrency, or history invariant that every writer must preserve. Document the invariant and cover its rejection behavior.

For prototypes, one active branch has one identity per repository, including concurrent writes. Retired branches keep their history. A registered prototype must have a nonblank name and cannot be a replica branch.

A Build number is positive and unique within its prototype. A known commit SHA uses 40 or 64 lowercase hexadecimal characters and is also unique within its prototype. A prototype's current Build, if set, belongs to that prototype.

Builds retain the commit author's provider, issuer, and provider user ID independently of Hub user IDs. Those three identity values must be present together or absent together. Login, name, and avatar are snapshots and may be unavailable. When Build timestamps are present, they must match its state; older Builds may keep both timestamps unknown. A failure summary belongs only to a failed Build and is limited to 1,000 bytes.

Builds created before commit metadata was stored retain `NULL` for unknown values during the upgrade. A later detail API must represent missing values rather than inventing them. This migration does not import Rails records or map their integer IDs.

PostgreSQL `CHECK` expressions accept `NULL` unless the expression explicitly rejects it. Write nullable-branch checks so every invalid `NULL` combination evaluates to false. Design indexes from the real equality, range, ordering, and partial predicates used by lock, restore, and lookup queries.

Validate schema changes on both a fresh database and an upgrade from the exact base. Migration tests should seed representative base records and prove required data, backfills, relationships, and constraints after deployment. Do not enumerate the complete migration, table, column, or index inventory. Split PostgreSQL enum additions from statements that use the new values when transactional enum visibility requires a committed boundary.

## Deployment database roles

The Azure installation separates database provisioning, migrations, and normal data access:

| Principal           | Access                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator       | One-time database and role provisioning; never passed to Hub or its setup job.                                                                                                                                                                                                                                       |
| `replica_migration` | Can create schemas in this database and owns `public`, `bullmq`, and their migration-created objects. Runs setup, not the long-running app.                                                                                                                                                                          |
| `replica_runtime`   | Uses both schemas, reads/writes application and queue data, uses sequences and executes queue functions. Cannot create schemas, change permanent schema objects, create roles, truncate tables, or change migration ledgers. BullMQ requires read access to its ledger and temporary-table permission for bulk jobs. |

`server/scripts/provision-database-access/` creates the two login roles and schema ownership on a fresh database. It requires administrator access over the private database network and separate passwords of at least 16 characters. Existing roles, public tables, or a pre-existing BullMQ schema cause failure and rollback rather than adopting unknown permissions. Use a reviewed ownership migration for existing installations.

When `DATABASE_RUNTIME_ROLE=replica_runtime`, setup runs `server/scripts/grant-runtime-database-access/` after Prisma and BullMQ setup. That script initializes the two queues' lazy ID sequences before granting data access, so runtime never needs permanent schema creation rights. It refreshes grants for newly migrated tables, sequences, and functions, excludes the Prisma ledger, and permits only reading BullMQ's ledger. Product additions that need other database capabilities must explicitly update and verify this contract.

Local development keeps its existing database user and leaves `DATABASE_RUNTIME_ROLE` unset. See the [Azure installation guide](../../infrastructure/README.md) for private-network provisioning, secret references, release ordering, and recovery.

The [database-enabled test projects](testing-and-operations.md#parallel-database-tests) use separate databases for every project, worker, and test run. Setup deploys the committed migrations and clears records before each case. Tests do not use the development database for records.

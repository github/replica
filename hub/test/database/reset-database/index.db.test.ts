import pg from "pg"
import pino from "pino"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import { z } from "zod"

import { createJobProcessor } from "../../../server/integrations/bullmq/create-job-processor"
import { createJobQueue } from "../../../server/integrations/bullmq/create-job-queue"
import { createJobWorker } from "../../../server/integrations/bullmq/create-job-worker"
import { enqueueJob } from "../../../server/integrations/bullmq/enqueue-job"
import { migrateJobDatabase } from "../../../server/integrations/bullmq/migrate-job-database"
import { upsertJobSchedule } from "../../../server/integrations/bullmq/upsert-job-schedule"
import { getDatabaseUrl } from "../get-database-url"
import { resetDatabase } from "."

describe("resetDatabase() with job storage", () => {
  it("preserves migration ledgers across repeated resets while clearing jobs, schedules, and application rows", async () => {
    const databaseUrl = getDatabaseUrl()
    const client = new pg.Client({ connectionString: databaseUrl })
    await client.connect()
    let createdLedger = false
    let createdProbe = false
    let insertedMigration = false
    onTestFinished(async () => {
      try {
        if (createdProbe) await client.query("DROP TABLE public.jobs_reset_probe")
        if (insertedMigration) {
          await client.query(
            `DELETE FROM public."_prisma_migrations" WHERE id = 'jobs-reset-regression'`,
          )
        }
        if (createdLedger) await client.query(`DROP TABLE public."_prisma_migrations"`)
      } finally {
        await client.end()
      }
    })
    const existing = await client.query<{ ledger: string | null }>(
      `SELECT to_regclass('public._prisma_migrations')::text AS ledger`,
    )
    if (!existing.rows[0]?.ledger) {
      await client.query(`
        CREATE TABLE public."_prisma_migrations" (
          id text PRIMARY KEY,
          checksum text NOT NULL,
          migration_name text NOT NULL,
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          rolled_back_at timestamptz,
          logs text,
          applied_steps_count integer NOT NULL DEFAULT 0
        )
      `)
      createdLedger = true
    }
    await client.query(
      `INSERT INTO public."_prisma_migrations" (id, checksum, migration_name)
       VALUES ('jobs-reset-regression', 'fixture-checksum', 'jobs-reset-regression')`,
    )
    insertedMigration = true
    await client.query("CREATE TABLE public.jobs_reset_probe (value text NOT NULL)")
    createdProbe = true
    const initialMigration = await migrateJobDatabase(databaseUrl)
    expect(initialMigration).toBeGreaterThan(0)
    const bullmqLedger = await client.query("SELECT * FROM bullmq.migration")
    const prismaLedger = await client.query('SELECT * FROM public."_prisma_migrations"')
    expect(bullmqLedger.rows.length).toBeGreaterThan(0)

    const logger = pino({ level: "silent" })
    const definition = { name: "after-reset", schema: z.object({ cycle: z.number() }) }
    for (const cycle of [1, 2]) {
      await client.query("INSERT INTO public.jobs_reset_probe (value) VALUES ('clear me')")
      const scheduled = createJobQueue({ name: "scheduled", databaseUrl, logger })
      const onDemand = createJobQueue({ name: "on-demand", databaseUrl, logger })
      try {
        await enqueueJob(onDemand, definition, { cycle })
        await upsertJobSchedule(scheduled, {
          id: "reset-schedule",
          definition,
          payload: { cycle },
          repeat: { every: 60_000 },
        })
      } finally {
        await Promise.all([scheduled.close(), onDemand.close()])
      }

      await resetDatabase(databaseUrl)

      expect((await client.query("SELECT * FROM bullmq.migration")).rows).toEqual(bullmqLedger.rows)
      expect((await client.query('SELECT * FROM public."_prisma_migrations"')).rows).toEqual(
        prismaLedger.rows,
      )
      expect((await client.query("SELECT * FROM public.jobs_reset_probe")).rows).toEqual([])
      expect(await migrateJobDatabase(databaseUrl)).toBe(initialMigration)

      const freshScheduled = createJobQueue({ name: "scheduled", databaseUrl, logger })
      const freshOnDemand = createJobQueue({ name: "on-demand", databaseUrl, logger })
      const worker = createJobWorker({
        name: "on-demand",
        databaseUrl,
        logger,
        processors: [createJobProcessor(definition, ({ cycle }) => Promise.resolve(cycle))],
      })
      let running: Promise<void> | undefined
      try {
        expect(await freshScheduled.getJobSchedulersCount()).toBe(0)
        expect(await freshScheduled.getJobCountByTypes("waiting", "delayed")).toBe(0)
        expect(await freshOnDemand.getJobCountByTypes("waiting", "delayed")).toBe(0)
        await worker.waitUntilReady()
        running = worker.run()
        const job = await enqueueJob(freshOnDemand, definition, { cycle })
        await vi.waitFor(async () => expect(await job.getState()).toBe("completed"), {
          timeout: 5_000,
        })
        expect((await freshOnDemand.getJob(job.id!))?.returnvalue).toBe(cycle)
      } finally {
        await worker.close()
        await running
        await Promise.all([freshScheduled.close(), freshOnDemand.close()])
      }
    }
  }, 30_000)
})

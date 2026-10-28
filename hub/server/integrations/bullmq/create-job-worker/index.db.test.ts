import pino from "pino"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import { z } from "zod"

import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { openQueue } from "../../../../test/jobs/open-queue"
import { createJobProcessor } from "../create-job-processor"
import { enqueueJob } from "../enqueue-job"
import type { JobDefinition, JobProcessor, JobQueueName } from "../types"
import { upsertJobSchedule } from "../upsert-job-schedule"
import { createJobWorker } from "."

async function openWorker(
  name: JobQueueName,
  processors: JobProcessor[],
  databaseUrl = getDatabaseUrl(),
  logger = pino({ level: "silent" }),
) {
  const worker = createJobWorker({ name, databaseUrl, logger, processors })
  let running: Promise<void> | undefined
  onTestFinished(async () => {
    await worker.close()
    await running
  })
  await worker.waitUntilReady()
  return {
    worker,
    start: () => {
      running = worker.run()
    },
  }
}

describe("job processing with PostgreSQL", () => {
  it("uses the supplied worker database and processes heterogeneous typed handlers only after run", async () => {
    const databaseUrl = getDatabaseUrl()
    vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1:1/not-the-worker-database")
    const queue = openQueue("on-demand", databaseUrl)
    const numbers = { name: "double", schema: z.object({ value: z.number() }) }
    const words = { name: "uppercase", schema: z.object({ value: z.string() }) }
    const { worker, start } = await openWorker(
      "on-demand",
      [
        createJobProcessor(numbers, ({ value }) => Promise.resolve(value * 2)),
        createJobProcessor(words, ({ value }) => Promise.resolve(value.toUpperCase())),
      ],
      databaseUrl,
    )
    const numberJob = await enqueueJob(queue, numbers, { value: 21 })
    const wordJob = await enqueueJob(queue, words, { value: "ready" })

    expect(worker.isRunning()).toBe(false)
    expect(await numberJob.getState()).toBe("waiting")
    start()

    await vi.waitFor(
      async () => {
        expect(await numberJob.getState()).toBe("completed")
        expect(await wordJob.getState()).toBe("completed")
      },
      { timeout: 5_000 },
    )
    expect((await queue.getJob(numberJob.id!))?.returnvalue).toBe(42)
    expect((await queue.getJob(wordJob.id!))?.returnvalue).toBe("READY")
  }, 15_000)

  it("rejects invalid producer data and permanently rejects invalid stored payloads and unknown names", async () => {
    const queue = openQueue("on-demand")
    const definition: JobDefinition<unknown> = {
      name: "validated",
      schema: z.object({ count: z.number().int().positive() }),
    }
    const process = vi.fn(() => Promise.resolve("must not run"))
    const { start } = await openWorker("on-demand", [createJobProcessor(definition, process)])

    await expect(enqueueJob(queue, definition, { count: "invalid" })).rejects.toThrow()
    expect(await queue.getJobCountByTypes("waiting", "delayed", "failed")).toBe(0)
    const malformed = await queue.add(definition.name, { count: "invalid" }, { attempts: 3 })
    const unknown = await queue.add("unregistered", { count: 1 }, { attempts: 3 })
    start()

    await vi.waitFor(
      async () => {
        expect(await malformed.getState()).toBe("failed")
        expect(await unknown.getState()).toBe("failed")
      },
      { timeout: 5_000 },
    )
    expect((await queue.getJob(malformed.id!))?.attemptsMade).toBe(1)
    expect((await queue.getJob(unknown.id!))?.attemptsMade).toBe(1)
    expect(process).not.toHaveBeenCalled()
  }, 15_000)

  it("retries ordinary errors but stops immediately when the handler marks an error permanent", async () => {
    const queue = openQueue("on-demand")
    const definition = {
      name: "retryable",
      schema: z.object({ label: z.string() }),
      options: { attempts: 3, backoff: { type: "fixed", delay: 10 } },
    }
    const retry = vi.fn(({ label }: { label: string }) => {
      if (retry.mock.calls.length < 2) {
        return Promise.reject(new Error("Temporary dependency failure"))
      }
      return Promise.resolve(label)
    })
    const permanent = vi.fn(() => Promise.reject(new Error("private-error-marker")))
    const lines: string[] = []
    const logger = pino({ level: "info" }, { write: (line) => lines.push(line) })
    const { worker, start } = await openWorker(
      "on-demand",
      [
        createJobProcessor(definition, retry),
        createJobProcessor({ ...definition, name: "permanent" }, permanent, () => false),
      ],
      getDatabaseUrl(),
      logger,
    )
    const retryJob = await enqueueJob(queue, definition, { label: "recovered" })
    const permanentJob = await enqueueJob(
      queue,
      { ...definition, name: "permanent" },
      { label: "private-payload-marker" },
    )
    start()

    await vi.waitFor(
      async () => {
        expect(await retryJob.getState()).toBe("completed")
        expect(await permanentJob.getState()).toBe("failed")
      },
      { timeout: 5_000 },
    )
    expect(retry).toHaveBeenCalledTimes(2)
    expect(permanent).toHaveBeenCalledTimes(1)
    expect((await queue.getJob(retryJob.id!))?.returnvalue).toBe("recovered")
    expect((await queue.getJob(permanentJob.id!))?.attemptsMade).toBe(1)
    expect(() => worker.emit("error", new Error("private-connection-marker"))).not.toThrow()
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join("")).not.toMatch(
      /private-error-marker|private-payload-marker|private-connection-marker/,
    )
  }, 15_000)

  it("keeps a stable schedule id while updating its payload, interval, and job defaults", async () => {
    const queue = openQueue("scheduled")
    const definition = {
      name: "periodic",
      schema: z.object({ version: z.number() }),
      options: { attempts: 2, priority: 4, backoff: { type: "fixed", delay: 20 } },
    }

    await upsertJobSchedule(queue, {
      id: "stable-schedule",
      definition,
      payload: { version: 1 },
      repeat: { every: 60_000 },
    })
    const updatedDefinition = {
      ...definition,
      name: "updated-periodic",
      options: { attempts: 4, priority: 2, backoff: { type: "fixed", delay: 30 } },
    }
    await upsertJobSchedule(queue, {
      id: "stable-schedule",
      definition: updatedDefinition,
      payload: { version: 2 },
      repeat: { every: 120_000 },
    })

    expect(await queue.getJobSchedulersCount()).toBe(1)
    expect(await queue.getJobScheduler("stable-schedule")).toMatchObject({
      name: updatedDefinition.name,
      every: 120_000,
      template: { data: { version: 2 }, opts: updatedDefinition.options },
    })
  }, 15_000)

  it("actually executes recurring jobs rather than only storing schedule metadata", async () => {
    const queue = openQueue("scheduled")
    const definition = {
      name: "recurring",
      schema: z.object({ marker: z.string() }),
    }
    const process = vi.fn(({ marker }: { marker: string }) => Promise.resolve(marker))
    const { start } = await openWorker("scheduled", [createJobProcessor(definition, process)])
    await upsertJobSchedule(queue, {
      id: "recurring-schedule",
      definition,
      payload: { marker: "tick" },
      repeat: { every: 100 },
    })
    start()

    await vi.waitFor(() => expect(process.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    })
    expect(process.mock.calls.every(([payload]) => payload.marker === "tick")).toBe(true)
  }, 15_000)

  it("processes on-demand work while the scheduled worker has an active job and a backlog", async () => {
    const scheduled = openQueue("scheduled")
    const onDemand = openQueue("on-demand")
    const definition = { name: "isolated", schema: z.object({ value: z.number() }) }
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduledProcess = vi.fn(async () => {
      await gate
      return "released"
    })
    const scheduledWorker = await openWorker("scheduled", [
      createJobProcessor(definition, scheduledProcess),
    ])
    const onDemandWorker = await openWorker("on-demand", [
      createJobProcessor(definition, ({ value }) => Promise.resolve(value)),
    ])
    const active = await enqueueJob(scheduled, definition, { value: 1 })
    const waiting = await enqueueJob(scheduled, definition, { value: 2 })
    scheduledWorker.start()
    onDemandWorker.start()

    try {
      await vi.waitFor(() => expect(scheduledProcess).toHaveBeenCalledTimes(1), {
        timeout: 5_000,
      })
      const urgent = await enqueueJob(onDemand, definition, { value: 3 })
      await vi.waitFor(async () => expect(await urgent.getState()).toBe("completed"), {
        timeout: 5_000,
      })

      expect(await active.getState()).toBe("active")
      expect(await waiting.getState()).toBe("waiting")
      expect((await onDemand.getJob(urgent.id!))?.returnvalue).toBe(3)
    } finally {
      release?.()
    }
  }, 15_000)

  it("rejects queue write failures instead of returning a successful enqueue", async () => {
    const queue = openQueue("on-demand")
    const definition = { name: "unavailable", schema: z.object({ value: z.number() }) }
    const failure = new Error("Queue unavailable")
    vi.spyOn(queue, "add").mockRejectedValueOnce(failure)

    await expect(enqueueJob(queue, definition, { value: 1 })).rejects.toBe(failure)
  }, 15_000)

  it("validates producer data and honors per-job overrides alongside definition defaults", async () => {
    const queue = openQueue("on-demand")
    const definition = {
      name: "configured",
      schema: z.object({ label: z.string().trim() }),
      options: { attempts: 3, priority: 8, backoff: { type: "fixed", delay: 20 } },
    }

    const job = await enqueueJob(
      queue,
      definition,
      { label: " normalized " },
      { jobId: "explicit-job-id", priority: 2, delay: 60_000 },
    )

    expect(job.id).toBe("explicit-job-id")
    expect(job.data).toEqual({ label: "normalized" })
    expect(job.opts).toMatchObject({
      attempts: 3,
      backoff: definition.options.backoff,
      priority: 2,
      delay: 60_000,
    })
    expect(await job.getState()).toBe("delayed")
  }, 15_000)
})

import { describe, expect, it, vi } from "vitest"

import { enqueueRecoverableJob } from "."

describe("enqueueRecoverableJob()", () => {
  it("replaces a retained failed job before re-enqueueing pending work", async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const existing = {
      getState: vi.fn().mockResolvedValue("failed"),
      remove,
    }
    const add = vi.fn().mockResolvedValue({ id: "job-1" })
    const queue = { getJob: vi.fn().mockResolvedValue(existing), add }
    const definition = { name: "test.job", schema: { parse: (value: unknown) => value } }

    await enqueueRecoverableJob(queue as never, definition as never, { value: 1 }, "job-1")

    expect(remove).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledOnce()
  })

  it("keeps an active job with the stable ID", async () => {
    const existing = {
      getState: vi.fn().mockResolvedValue("active"),
      remove: vi.fn(),
    }
    const add = vi.fn()
    const queue = { getJob: vi.fn().mockResolvedValue(existing), add }
    const definition = { name: "test.job", schema: { parse: (value: unknown) => value } }

    await expect(
      enqueueRecoverableJob(queue as never, definition as never, { value: 1 }, "job-1"),
    ).resolves.toBe(existing)
    expect(existing.remove).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it("applies a dispatch priority when it re-enqueues work", async () => {
    const add = vi.fn().mockResolvedValue({ id: "job-1" })
    const queue = { getJob: vi.fn().mockResolvedValue(null), add }
    const definition = { name: "test.job", schema: { parse: (value: unknown) => value } }

    await enqueueRecoverableJob(queue as never, definition as never, { value: 1 }, "job-1", {
      priority: 10,
    })

    expect(add).toHaveBeenCalledWith(
      "test.job",
      { value: 1 },
      expect.objectContaining({ jobId: "job-1", priority: 10 }),
    )
  })

  it("updates a retained waiting job to the requested dispatch priority", async () => {
    const changePriority = vi.fn().mockResolvedValue(undefined)
    const existing = {
      changePriority,
      getState: vi.fn().mockResolvedValue("waiting"),
      remove: vi.fn(),
    }
    const add = vi.fn()
    const queue = { getJob: vi.fn().mockResolvedValue(existing), add }
    const definition = { name: "test.job", schema: { parse: (value: unknown) => value } }

    await expect(
      enqueueRecoverableJob(queue as never, definition as never, { value: 1 }, "job-1", {
        priority: 10,
      }),
    ).resolves.toBe(existing)

    expect(changePriority).toHaveBeenCalledWith({ priority: 10 })
    expect(add).not.toHaveBeenCalled()
  })
})

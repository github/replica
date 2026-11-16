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
})

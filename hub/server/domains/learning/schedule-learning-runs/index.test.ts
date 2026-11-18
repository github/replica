import { describe, expect, it, vi } from "vitest"

import { scheduleLearningRuns } from "."

function dependencies(overrides: Partial<Parameters<typeof scheduleLearningRuns>[0]> = {}) {
  return {
    automaticEnabled: true,
    copilotUsable: vi.fn().mockResolvedValue(true),
    deleteExpired: vi.fn().mockResolvedValue(undefined),
    listDue: vi
      .fn()
      .mockResolvedValue([
        { id: "11111111-1111-4111-8111-111111111111" },
        { id: "22222222-2222-4222-8222-222222222222" },
      ]),
    capture: vi
      .fn()
      .mockImplementation((repositoryId: string) =>
        Promise.resolve({ digest: `sha256:${repositoryId}` }),
      ),
    create: vi
      .fn()
      .mockImplementation(({ repositoryId }: { repositoryId: string }) =>
        Promise.resolve({ run: { id: `run-${repositoryId}` }, created: true }),
      ),
    enqueue: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => new Date("2026-11-18T10:00:00Z")),
    ...overrides,
  }
}

describe("scheduleLearningRuns()", () => {
  it("does not inspect or create runs when automatic scheduling is disabled", async () => {
    const deps = dependencies({ automaticEnabled: false })

    await expect(scheduleLearningRuns(deps)).resolves.toEqual({ scheduled: 0 })

    expect(deps.copilotUsable).not.toHaveBeenCalled()
    expect(deps.listDue).not.toHaveBeenCalled()
    expect(deps.create).not.toHaveBeenCalled()
  })

  it("does not create runs when Copilot is unavailable", async () => {
    const deps = dependencies({ copilotUsable: vi.fn().mockResolvedValue(false) })

    await expect(scheduleLearningRuns(deps)).resolves.toEqual({ scheduled: 0 })

    expect(deps.deleteExpired).toHaveBeenCalledOnce()
    expect(deps.listDue).not.toHaveBeenCalled()
    expect(deps.create).not.toHaveBeenCalled()
  })

  it("captures due repositories in order and skips one made active during capture", async () => {
    const deps = dependencies({
      create: vi
        .fn()
        .mockResolvedValueOnce({
          run: { id: "run-11111111-1111-4111-8111-111111111111" },
          created: true,
        })
        .mockResolvedValueOnce({
          run: { id: "existing-user-run" },
          created: false,
        }),
    })

    await expect(scheduleLearningRuns(deps)).resolves.toEqual({ scheduled: 1 })

    expect(deps.capture).toHaveBeenNthCalledWith(1, "11111111-1111-4111-8111-111111111111")
    expect(deps.capture).toHaveBeenNthCalledWith(2, "22222222-2222-4222-8222-222222222222")
    expect(deps.create).toHaveBeenNthCalledWith(1, {
      repositoryId: "11111111-1111-4111-8111-111111111111",
      scheduled: true,
      snapshotDigest: "sha256:11111111-1111-4111-8111-111111111111",
    })
    expect(deps.enqueue).toHaveBeenCalledTimes(1)
    expect(deps.enqueue).toHaveBeenCalledWith("run-11111111-1111-4111-8111-111111111111")
  })

  it("keeps enqueue failures visible and continues scheduling later repositories", async () => {
    const deps = dependencies({
      enqueue: vi
        .fn()
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValueOnce(undefined),
    })

    await expect(scheduleLearningRuns(deps)).resolves.toEqual({ scheduled: 1 })

    expect(deps.fail).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.fail).mock.calls[0]?.[0]).toBe("run-11111111-1111-4111-8111-111111111111")
    expect(deps.enqueue).toHaveBeenCalledTimes(2)
  })

  it("skips a repository that becomes unavailable before snapshot capture", async () => {
    const deps = dependencies({
      capture: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ digest: "sha256:available" }),
    })

    await expect(scheduleLearningRuns(deps)).resolves.toEqual({ scheduled: 1 })

    expect(deps.create).toHaveBeenCalledOnce()
    expect(deps.create).toHaveBeenCalledWith({
      repositoryId: "22222222-2222-4222-8222-222222222222",
      scheduled: true,
      snapshotDigest: "sha256:available",
    })
  })

  it("skips a repository that becomes unavailable after snapshot capture", async () => {
    const deps = dependencies({
      create: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          run: { id: "run-22222222-2222-4222-8222-222222222222" },
          created: true,
        }),
    })

    await expect(scheduleLearningRuns(deps)).resolves.toEqual({ scheduled: 1 })

    expect(deps.capture).toHaveBeenCalledTimes(2)
    expect(deps.enqueue).toHaveBeenCalledOnce()
    expect(deps.enqueue).toHaveBeenCalledWith("run-22222222-2222-4222-8222-222222222222")
  })
})

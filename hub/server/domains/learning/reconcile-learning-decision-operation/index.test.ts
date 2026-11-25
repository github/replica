import { describe, expect, it, vi } from "vitest"

import { reconcileLearningDecisionOperation } from "."

const operation = {
  id: "11111111-2222-4333-8444-555555555555",
  actorMembershipId: "22222222-2222-4222-8222-222222222222",
  decision: "accept",
  learningId: "mem_1",
  repositoryId: "33333333-3333-4333-8333-333333333333",
}

describe("reconcileLearningDecisionOperation()", () => {
  it("records success when the package store contains the intended decision", async () => {
    const finish = vi.fn().mockResolvedValue(undefined)
    const runCommand = vi.fn().mockResolvedValue({ state: "accepted" })

    await reconcileLearningDecisionOperation(operation, {
      finish,
      prepare: vi.fn().mockResolvedValue({
        directory: "/private/store",
        repositoryScope: "github.com/repositories/123",
        repositoryId: operation.repositoryId,
      }),
      runCommand,
      withLock: async (run) => await run(new AbortController().signal),
    })

    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: operation.id,
        outcome: "succeeded",
      }),
    )
    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--repository",
        "github.com/repositories/123",
        "--legacy-repository",
        `github.com/repositories/${operation.repositoryId}`,
      ]),
      expect.anything(),
    )
  })

  it("recovers a committed edit as a successful decision", async () => {
    const finish = vi.fn().mockResolvedValue(undefined)
    const runCommand = vi.fn().mockResolvedValue({ state: "accepted" })

    await reconcileLearningDecisionOperation(
      { ...operation, decision: "edit" },
      {
        finish,
        prepare: vi.fn().mockResolvedValue({
          directory: "/private/store",
          repositoryScope: "github.com/repositories/123",
          repositoryId: operation.repositoryId,
        }),
        runCommand,
        withLock: async (run) => await run(new AbortController().signal),
      },
    )

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["operation-status", "mem_1", "--operation-id", operation.id]),
      expect.anything(),
    )
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: operation.id, outcome: "succeeded" }),
    )
  })

  it("recovers a committed reinstatement as a successful decision", async () => {
    const finish = vi.fn().mockResolvedValue(undefined)
    const runCommand = vi.fn().mockResolvedValue({ state: "accepted" })

    await reconcileLearningDecisionOperation(
      { ...operation, decision: "reinstate" },
      {
        finish,
        prepare: vi.fn().mockResolvedValue({
          directory: "/private/store",
          repositoryScope: "github.com/repositories/123",
          repositoryId: operation.repositoryId,
        }),
        runCommand,
        withLock: async (run) => await run(new AbortController().signal),
      },
    )

    expect(runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["operation-status", "mem_1", "--operation-id", operation.id]),
      expect.anything(),
    )
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: operation.id, outcome: "succeeded" }),
    )
  })

  it("does not report a reinstatement as successful while the learning remains retired", async () => {
    const finish = vi.fn().mockResolvedValue(undefined)

    await reconcileLearningDecisionOperation(
      { ...operation, decision: "reinstate" },
      {
        finish,
        prepare: vi.fn().mockResolvedValue({
          directory: "/private/store",
          repositoryScope: "github.com/repositories/123",
          repositoryId: operation.repositoryId,
        }),
        runCommand: vi.fn().mockResolvedValue({ state: "retired" }),
        withLock: async (run) => await run(new AbortController().signal),
      },
    )

    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: operation.id,
        outcome: "failed",
        reason: "interrupted_or_failed",
      }),
    )
  })

  it("keeps the durable intent pending when the package store cannot be read", async () => {
    const finish = vi.fn()

    await expect(
      reconcileLearningDecisionOperation(operation, {
        finish,
        prepare: vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" })),
        runCommand: vi.fn(),
        withLock: async (run) => await run(new AbortController().signal),
      }),
    ).rejects.toMatchObject({ code: "EACCES" })
    expect(finish).not.toHaveBeenCalled()
  })

  it("records failure after an interrupted command left the proposal undecided", async () => {
    const finish = vi.fn().mockResolvedValue(undefined)

    await reconcileLearningDecisionOperation(operation, {
      finish,
      prepare: vi.fn().mockResolvedValue({
        directory: "/private/store",
        repositoryScope: "github.com/repositories/123",
        repositoryId: operation.repositoryId,
      }),
      runCommand: vi.fn().mockResolvedValue({ state: null }),
      withLock: async (run) => await run(new AbortController().signal),
    })

    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: operation.id,
        outcome: "failed",
        reason: "interrupted_or_failed",
      }),
    )
  })
})

import { describe, expect, it, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors"
import { proposeLearningUpdate } from "."

async function withLock<T>(operation: (signal: AbortSignal) => Promise<T>) {
  return await operation(new AbortController().signal)
}

const request = { id: "request-1", repositoryId: "repository-1", memoryId: "memory-1", revision: 2 }

describe("proposeLearningUpdate", () => {
  it("records the check's result and cost, then drops the flag it saw", async () => {
    const finish = vi.fn(() => Promise.resolve())
    const deleteRequest = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn(() =>
      Promise.resolve({ state: "proposed", usage: { requests: 1, nanoAiu: 500_000_000 } }),
    )

    const result = await proposeLearningUpdate(request, {
      closeAbandoned: () => Promise.resolve(),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest,
      finish,
      isEnabled: () => Promise.resolve(true),
      now: () => new Date("2026-12-27T03:00:00Z"),
      prepare: () => Promise.resolve(["--store", "hub"]),
      runCommand,
      start: () => Promise.resolve({ id: "run-1" }),
      withinBudget: () => Promise.resolve(true),
      withLock,
    })

    expect(result).toBe("done")
    expect(runCommand.mock.calls[0]).toEqual([
      ["propose-update", "memory-1", "--store", "hub"],
      expect.objectContaining({ githubToken: "token" }),
    ])
    expect(finish).toHaveBeenCalledWith("run-1", {
      state: "SUCCEEDED",
      result: "proposed",
      aiCredits: "0.5",
      copilotRequests: 1,
      finishedAt: new Date("2026-12-27T03:00:00Z"),
    })
    expect(deleteRequest).toHaveBeenCalledWith(request)
  })

  it("keeps the flag when Copilot is down, after recording what the attempt spent", async () => {
    const finish = vi.fn(() => Promise.resolve())
    const deleteRequest = vi.fn(() => Promise.resolve())

    const result = await proposeLearningUpdate(request, {
      closeAbandoned: () => Promise.resolve(),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest,
      finish,
      isEnabled: () => Promise.resolve(true),
      now: () => new Date("2026-12-27T03:00:00Z"),
      prepare: () => Promise.resolve([]),
      runCommand: () =>
        Promise.reject(
          new LearningCommandError("unavailable", "Copilot is unavailable.", {
            result: { usage: { requests: 1, nanoAiu: 0 } },
          }),
        ),
      start: () => Promise.resolve({ id: "run-1" }),
      withinBudget: () => Promise.resolve(true),
      withLock,
    })

    expect(result).toBe("paused")
    expect(finish).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "FAILED", failureCode: "unavailable", copilotRequests: 1 }),
    )
    expect(deleteRequest).not.toHaveBeenCalled()
  })

  it("closes abandoned checks and drops the flag once evaluations are off", async () => {
    const closeAbandoned = vi.fn(() => Promise.resolve())
    const deleteRequest = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn()

    const result = await proposeLearningUpdate(request, {
      closeAbandoned,
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest,
      finish: () => Promise.resolve(),
      isEnabled: () => Promise.resolve(false),
      now: () => new Date("2026-12-27T03:00:00Z"),
      prepare: () => Promise.resolve([]),
      runCommand,
      start: () => Promise.resolve({ id: "run-1" }),
      withinBudget: () => Promise.resolve(true),
      withLock,
    })

    expect(result).toBe("done")
    expect(closeAbandoned).toHaveBeenCalledWith(new Date("2026-12-27T03:00:00Z"))
    expect(runCommand).not.toHaveBeenCalled()
    expect(deleteRequest).toHaveBeenCalledWith(request)
  })
})

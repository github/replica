import { describe, expect, it, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors"
import { processLearningRun } from "."

type Dependencies = Parameters<typeof processLearningRun>[1]
type RunRecord = Awaited<ReturnType<Dependencies["getRun"]>>

function dependencies(overrides: Partial<Dependencies> = {}) {
  const commands: string[][] = []
  const finished: Array<{ id: string; input: unknown }> = []
  const progress: Array<{ id: string; input: unknown }> = []
  const run: Exclude<RunRecord, null> = {
    id: "11111111-2222-4333-8444-555555555555",
    repositoryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    snapshotDigest: "sha256:snapshot",
    state: "QUEUED",
    startedAt: new Date("2026-11-13T09:59:00Z"),
    requestedBy: { profile: { login: "mona" } },
  }
  async function withLock<T>(operation: (signal: AbortSignal) => Promise<T>) {
    return await operation(new AbortController().signal)
  }
  const base: Dependencies = {
    claim: vi.fn(() => {
      run.state = "RUNNING"
      return Promise.resolve(true)
    }),
    capture: vi.fn().mockResolvedValue({
      collection: { kind: "replica.hub-review-collection/v1" },
      digest: "sha256:snapshot",
      capturedAt: new Date("2026-11-13T09:00:00Z"),
    }),
    finish: vi.fn((id: string, input: Parameters<Dependencies["finish"]>[1]) => {
      finished.push({ id, input })
      return Promise.resolve()
    }),
    getRun: vi.fn().mockImplementation(() => Promise.resolve(run)),
    now: vi.fn(() => new Date("2026-11-13T10:00:00Z")),
    prepare: vi.fn().mockResolvedValue({
      directory: "/private/repository",
      repositoryScope: "github.com/repositories/repository",
    }),
    runCommand: vi.fn((arguments_: string[]) => {
      commands.push(arguments_)
      if (arguments_[0] === "grants" && arguments_[1] === "list") {
        return Promise.resolve([])
      }
      if (arguments_[0] === "grants" && arguments_[1] === "add") {
        return Promise.resolve({ id: "grant-1" })
      }
      if (arguments_[0] === "import") {
        return Promise.resolve({ complete: true, problems: [] })
      }
      if (arguments_[0] === "label") {
        return Promise.resolve({
          considered: 4,
          labeled: 3,
          remaining: 1,
          usage: { requests: 2, nanoAiu: 2_500_000 },
        })
      }
      return Promise.resolve({
        status: "complete",
        proposals: [{ id: "proposal-1", updatedAt: "2026-11-13T10:00:00Z" }],
        overBudget: 1,
      })
    }),
    credential: vi.fn().mockResolvedValue({ githubToken: "token" }),
    updateProgress: vi.fn((id: string, input: Parameters<Dependencies["updateProgress"]>[1]) => {
      progress.push({ id, input })
      return Promise.resolve()
    }),
    withLock,
  }
  return { ...base, ...overrides, commands, finished, progress, run }
}

describe("processLearningRun()", () => {
  it("claims once, imports with redaction, records usage, and finishes success", async () => {
    const deps = dependencies()

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.claim).toHaveBeenCalledOnce()
    expect(deps.commands.find((arguments_) => arguments_[0] === "import")).toContain(
      "--redact-deleted",
    )
    expect(deps.progress.at(-1)).toEqual({
      id: "11111111-2222-4333-8444-555555555555",
      input: {
        commentsConsidered: 4,
        commentsLabeled: 3,
        commentsRemaining: 1,
        copilotRequests: 2,
        aiCredits: "0.0025",
      },
    })
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "SUCCEEDED",
        suggestions: 1,
        suggestionsRemaining: 1,
      },
    })
  })

  it("finishes visibly failed when the imported snapshot is incomplete", async () => {
    const deps = dependencies({
      runCommand: vi.fn((arguments_: string[]) => {
        if (arguments_[0] === "grants" && arguments_[1] === "list") {
          return Promise.resolve([])
        }
        if (arguments_[0] === "grants" && arguments_[1] === "add") {
          return Promise.resolve({ id: "grant-1" })
        }
        if (arguments_[0] === "import") {
          return Promise.resolve({ complete: false, problems: ["missing reply page"] })
        }
        return Promise.reject(new Error("Later commands must not run."))
      }),
    })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "incomplete_collection",
        failureSummary: "The repository review snapshot is incomplete: missing reply page",
      },
    })
  })

  it("resumes a run left running after a worker interruption", async () => {
    const deps = dependencies()
    deps.run.state = "RUNNING"

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.finished[0]).toMatchObject({ input: { state: "SUCCEEDED" } })
  })

  it("preserves partial label usage when Copilot fails", async () => {
    const refuseCredential = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies({
      refuseCredential,
      runCommand: vi.fn((arguments_: string[]) => {
        if (arguments_[0] === "grants" && arguments_[1] === "list") {
          return Promise.resolve([])
        }
        if (arguments_[0] === "grants" && arguments_[1] === "add") {
          return Promise.resolve({ id: "grant-1" })
        }
        if (arguments_[0] === "import") {
          return Promise.resolve({ complete: true, problems: [] })
        }
        if (arguments_[0] === "label") {
          return Promise.reject(
            new LearningCommandError("unauthorized", "Copilot refused the credential.", {
              result: {
                considered: 3,
                labeled: 2,
                remaining: 1,
                usage: { requests: 2, nanoAiu: 1_250_000 },
              },
            }),
          )
        }
        return Promise.reject(new Error("Consolidation must not run."))
      }),
    })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.progress).toEqual([
      {
        id: "11111111-2222-4333-8444-555555555555",
        input: {
          commentsConsidered: 3,
          commentsLabeled: 2,
          commentsRemaining: 1,
          copilotRequests: 2,
          aiCredits: "0.00125",
        },
      },
    ])
    expect(refuseCredential).toHaveBeenCalledOnce()
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "unauthorized",
        failureSummary: "Copilot refused the credential.",
      },
    })
  })
})

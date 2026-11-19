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
    scheduled: false,
    state: "QUEUED",
    startedAt: new Date("2026-11-13T09:59:00Z"),
    requestedBy: { profile: { login: "mona" } },
    requestedByMembershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  }
  async function withLock<T>(
    operation: (
      signal: AbortSignal,
      controls: {
        runWithoutRepositoryAuthorityLock: <Result>(
          operation: () => Promise<Result>,
        ) => Promise<Result>
      },
    ) => Promise<T>,
  ) {
    return await operation(new AbortController().signal, {
      runWithoutRepositoryAuthorityLock: async (run) => await run(),
    })
  }
  const base: Dependencies = {
    expectedScheduled: false,
    claim: vi.fn(() => {
      run.state = "RUNNING"
      return Promise.resolve(true)
    }),
    capture: vi.fn().mockResolvedValue({
      collection: { kind: "replica.hub-review-collection/v1" },
      digest: "sha256:snapshot",
      capturedAt: new Date("2026-11-13T09:00:00Z"),
      reviewActivitySnapshot: {},
    }),
    finish: vi.fn((id: string, input: Parameters<Dependencies["finish"]>[1]) => {
      finished.push({ id, input })
      return Promise.resolve()
    }),
    getRun: vi.fn().mockImplementation(() => Promise.resolve(run)),
    hasPendingUserRun: vi.fn().mockResolvedValue(false),
    isRepositoryAvailable: vi.fn().mockResolvedValue(true),
    now: vi.fn(() => new Date("2026-11-13T10:00:00Z")),
    authorizeRepositoryAdministration: vi.fn().mockResolvedValue(true),
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
  it("runs for a Hub member with repository administrator authority", async () => {
    const deps = dependencies()

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.claim).toHaveBeenCalledOnce()
    expect(deps.authorizeRepositoryAdministration).toHaveBeenNthCalledWith(
      1,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )
    expect(deps.authorizeRepositoryAdministration).toHaveBeenNthCalledWith(
      2,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )
    expect(deps.commands.find((arguments_) => arguments_[0] === "import")).toContain(
      "--redact-deleted",
    )
    expect(
      deps.commands.find((arguments_) => arguments_[0] === "grants" && arguments_[1] === "add"),
    ).toEqual(expect.arrayContaining(["--by", "human:mona"]))
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

  it("defers a queued scheduled run before claim while user work is waiting", async () => {
    const deps = dependencies({
      expectedScheduled: true,
      hasPendingUserRun: vi.fn().mockResolvedValue(true),
    })
    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null

    await expect(processLearningRun("11111111-2222-4333-8444-555555555555", deps)).resolves.toBe(
      "deferred",
    )

    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.capture).not.toHaveBeenCalled()
    expect(deps.finished).toEqual([])
  })

  it("does not claim a scheduled run promoted after its initial read", async () => {
    const deps = dependencies({ expectedScheduled: true })
    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null
    deps.claim = vi.fn((_runId, _startedAt, scheduled) => {
      deps.run.scheduled = false
      deps.run.requestedBy = { profile: { login: "mona" } }
      deps.run.requestedByMembershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      return Promise.resolve(scheduled === deps.run.scheduled)
    })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.claim).toHaveBeenCalledWith(
      "11111111-2222-4333-8444-555555555555",
      new Date("2026-11-13T10:00:00Z"),
      true,
    )
    expect(deps.capture).not.toHaveBeenCalled()
    expect(deps.finished).toEqual([])
  })

  it("does not claim a run promoted before the scheduled processor reads it", async () => {
    const deps = dependencies({ expectedScheduled: true })
    deps.run.scheduled = false

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.capture).not.toHaveBeenCalled()
    expect(deps.finished).toEqual([])
  })

  it("fails a first scheduled run without creating consent", async () => {
    const deps = dependencies({ expectedScheduled: true })
    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.authorizeRepositoryAdministration).not.toHaveBeenCalled()
    expect(
      deps.commands.find((arguments_) => arguments_[0] === "grants" && arguments_[1] === "add"),
    ).toBeUndefined()
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "grant_required",
      },
    })
  })

  it("uses an active human-approved grant for a scheduled run", async () => {
    const deps = dependencies({
      expectedScheduled: true,
      runCommand: vi.fn((arguments_: string[]) => {
        if (arguments_[0] === "grants" && arguments_[1] === "list") {
          return Promise.resolve([
            {
              grant: {
                id: "grant-1",
                sources: ["hub_review_comments"],
                grantedBy: { kind: "human", id: "github:mona" },
              },
              activePurposes: ["review", "instruction"],
              expired: false,
            },
          ])
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
    })
    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(
      vi
        .mocked(deps.runCommand)
        .mock.calls.find(([arguments_]) => arguments_[0] === "grants" && arguments_[1] === "add"),
    ).toBeUndefined()
    expect(deps.finished[0]).toMatchObject({ input: { state: "SUCCEEDED" } })
  })

  it("rejects an active grant that was not approved by a person", async () => {
    const deps = dependencies({
      expectedScheduled: true,
      runCommand: vi.fn((arguments_: string[]) => {
        if (arguments_[0] === "grants" && arguments_[1] === "list") {
          return Promise.resolve([
            {
              grant: {
                id: "grant-1",
                sources: ["hub_review_comments"],
                grantedBy: { kind: "system", id: "system:replica-hub" },
              },
              activePurposes: ["review", "instruction"],
              expired: false,
            },
          ])
        }
        return Promise.reject(new Error("No later command should run."))
      }),
    })
    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "grant_required",
      },
    })
  })

  it("fails a scheduled run visibly when evidence changes after scheduling", async () => {
    const deps = dependencies({
      expectedScheduled: true,
      capture: vi.fn().mockResolvedValue({
        collection: { kind: "replica.hub-review-collection/v1" },
        digest: "sha256:changed",
        capturedAt: new Date("2026-11-13T09:00:00Z"),
        reviewActivitySnapshot: {},
      }),
    })

    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.prepare).not.toHaveBeenCalled()
    expect(deps.runCommand).not.toHaveBeenCalled()
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "snapshot_changed",
      },
    })
  })

  it("fails a scheduled run when the repository is removed during labeling", async () => {
    const deps = dependencies({
      expectedScheduled: true,
      isRepositoryAvailable: vi.fn().mockResolvedValue(false),
      runCommand: vi.fn((arguments_: string[]) => {
        if (arguments_[0] === "grants" && arguments_[1] === "list") {
          return Promise.resolve([
            {
              grant: {
                id: "grant-1",
                sources: ["hub_review_comments"],
                grantedBy: { kind: "human", id: "github:mona" },
              },
              activePurposes: ["review", "instruction"],
              expired: false,
            },
          ])
        }
        if (arguments_[0] === "import") {
          return Promise.resolve({ complete: true, problems: [] })
        }
        if (arguments_[0] === "label") {
          return Promise.resolve({
            considered: 1,
            labeled: 1,
            remaining: 0,
            usage: { requests: 1, nanoAiu: 1 },
          })
        }
        return Promise.reject(new Error("Consolidation must not run."))
      }),
    })
    deps.run.scheduled = true
    deps.run.requestedBy = null
    deps.run.requestedByMembershipId = null

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.isRepositoryAvailable).toHaveBeenCalledWith(deps.run.repositoryId)
    expect(deps.finished[0]).toMatchObject({
      input: { state: "FAILED", failureCode: "not_authorized" },
    })
  })

  it("defers a recovered running job when another learning mutation holds the lock", async () => {
    const deps = dependencies({
      withLock: () => Promise.reject(new Error("Another learning operation is still running.")),
    })
    deps.run.state = "RUNNING"

    await expect(processLearningRun("11111111-2222-4333-8444-555555555555", deps)).resolves.toBe(
      "deferred",
    )
    expect(deps.finished).toEqual([])
  })

  it("does not substitute Hub administration after repository authority is revoked", async () => {
    const deps = dependencies({
      authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
    })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.runCommand).not.toHaveBeenCalled()
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "not_authorized",
      },
    })
  })

  it("stops after labeling when repository authority is revoked during that phase", async () => {
    const authorizeRepositoryAdministration = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const deps = dependencies({ authorizeRepositoryAdministration })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(deps.commands.some((arguments_) => arguments_[0] === "label")).toBe(true)
    expect(deps.commands.some((arguments_) => arguments_[0] === "consolidate")).toBe(false)
    expect(deps.progress).toEqual([
      {
        id: "11111111-2222-4333-8444-555555555555",
        input: {
          commentsConsidered: 4,
          commentsLabeled: 3,
          commentsRemaining: 1,
          copilotRequests: 2,
          aiCredits: "0.0025",
        },
      },
    ])
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "not_authorized",
      },
    })
  })

  it("retries a transient authority deadlock after labeling", async () => {
    const authorizeRepositoryAdministration = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce({ code: "40P01" })
      .mockResolvedValueOnce(true)
    const deps = dependencies({ authorizeRepositoryAdministration })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(authorizeRepositoryAdministration).toHaveBeenCalledTimes(3)
    expect(deps.commands.some((arguments_) => arguments_[0] === "consolidate")).toBe(true)
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

  it("does not record credential refusal when Copilot is simply not connected", async () => {
    const refuseCredential = vi.fn()
    const deps = dependencies({
      credential: vi.fn().mockResolvedValue(null),
      refuseCredential,
    })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(refuseCredential).not.toHaveBeenCalled()
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "copilot_not_connected",
      },
    })
  })

  it("records refusal when the configured installation can no longer mint a credential", async () => {
    const refuseCredential = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies({
      credential: vi
        .fn()
        .mockRejectedValue(
          new LearningCommandError(
            "installation_revoked",
            "The configured GitHub App installation is unavailable.",
          ),
        ),
      refuseCredential,
    })

    await processLearningRun("11111111-2222-4333-8444-555555555555", deps)

    expect(refuseCredential).toHaveBeenCalledOnce()
    expect(deps.finished[0]).toMatchObject({
      input: {
        state: "FAILED",
        failureCode: "installation_revoked",
        failureSummary: "The configured GitHub App installation is unavailable.",
      },
    })
  })
})

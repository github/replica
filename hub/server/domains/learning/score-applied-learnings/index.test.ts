import { readdir, readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors"
import { scoreAppliedLearnings } from "."

async function withLock<T>(operation: (signal: AbortSignal) => Promise<T>) {
  return await operation(new AbortController().signal)
}

describe("scoreAppliedLearnings()", () => {
  it("scores with the commit's diff and the consented screenshots", async () => {
    const digest = "c".repeat(64)
    const finish = vi.fn(() => Promise.resolve())
    const readScreenshot = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])))
    let evidence: { diff: string; screenshots: string[] } | undefined
    const runCommand = vi.fn(async (arguments_: string[]) => {
      if (arguments_[0] === "usage") {
        return {
          reports: [
            {
              used: [
                { id: "learning-1", memoryId: "memory-1", after: { sha256: `sha256:${digest}` } },
              ],
            },
          ],
        }
      }
      const diffFile = arguments_[arguments_.indexOf("--diff-file") + 1]!
      const screenshots = arguments_[arguments_.indexOf("--screenshots") + 1]!
      evidence = {
        diff: await readFile(diffFile, "utf8"),
        screenshots: await readdir(screenshots),
      }
      return {
        score: { id: "score-1", memoryId: "memory-1" },
        usage: { requests: 1, nanoAiu: 2_000_000_000 },
      }
    })

    const result = await scoreAppliedLearnings({
      commitSha: "a".repeat(40),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest: () => Promise.resolve(),
      finish,
      hasPendingUserRun: () => Promise.resolve(false),
      isEnabled: () => Promise.resolve(true),
      now: () => new Date("2026-12-25T09:00:00Z"),
      prepare: () => Promise.resolve([]),
      readDiff: () => Promise.resolve("diff --git a/app.tsx b/app.tsx"),
      readScreenshot,
      refuseCredential: () => Promise.resolve(),
      requestUpdate: () => Promise.resolve(),
      runCommand,
      start: () => Promise.resolve({ id: "run-1", operationId: "op-1", state: "RUNNING" }),
      withinBudget: () => Promise.resolve(true),
      verifications: () => Promise.resolve([]),
      withLock,
    })

    expect(result).toBe("done")
    expect(readScreenshot).toHaveBeenCalledWith(digest)
    expect(evidence).toEqual({
      diff: "diff --git a/app.tsx b/app.tsx",
      screenshots: [`${digest}.png`],
    })
    expect(finish).toHaveBeenCalledWith("run-1", {
      state: "SUCCEEDED",
      scoreId: "score-1",
      aiCredits: "2",
      copilotRequests: 1,
      finishedAt: new Date("2026-12-25T09:00:00Z"),
    })
  })

  it("pauses and records the refusal when Copilot rejects the credential", async () => {
    const finish = vi.fn(() => Promise.resolve())
    const deleteRequest = vi.fn(() => Promise.resolve())
    const refuseCredential = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn((arguments_: string[]) => {
      if (arguments_[0] === "usage") {
        return Promise.resolve({
          reports: [
            {
              used: [
                { id: "learning-1", memoryId: "memory-1" },
                { id: "learning-2", memoryId: "memory-2" },
              ],
            },
          ],
        })
      }
      return Promise.reject(new LearningCommandError("unauthorized", "Copilot said no."))
    })

    const result = await scoreAppliedLearnings({
      commitSha: "a".repeat(40),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest,
      finish,
      hasPendingUserRun: () => Promise.resolve(false),
      isEnabled: () => Promise.resolve(true),
      now: () => new Date(),
      prepare: () => Promise.resolve([]),
      readDiff: () => Promise.resolve(null),
      readScreenshot: () => Promise.resolve(null),
      refuseCredential,
      requestUpdate: () => Promise.resolve(),
      runCommand,
      start: () => Promise.resolve({ id: "run-1", operationId: "op-1", state: "RUNNING" }),
      withinBudget: () => Promise.resolve(true),
      verifications: () => Promise.resolve([]),
      withLock,
    })

    expect(result).toBe("paused")
    expect(refuseCredential).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(finish).not.toHaveBeenCalled()
    expect(deleteRequest).not.toHaveBeenCalled()
  })

  it("records what a failed score spent and finishes the request", async () => {
    const finish = vi.fn(() => Promise.resolve())
    const deleteRequest = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn((arguments_: string[]) => {
      if (arguments_[0] === "usage") {
        return Promise.resolve({
          reports: [{ used: [{ id: "learning-1", memoryId: "memory-learning-1" }] }],
        })
      }
      return Promise.reject(
        new LearningCommandError("copilot_failed", "Copilot stopped.", {
          result: { usage: { requests: 2, nanoAiu: 1_500_000_000 } },
        }),
      )
    })

    const result = await scoreAppliedLearnings({
      commitSha: "a".repeat(40),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest,
      finish,
      hasPendingUserRun: () => Promise.resolve(false),
      isEnabled: () => Promise.resolve(true),
      now: () => new Date("2026-12-25T09:00:00Z"),
      prepare: () => Promise.resolve(["--store", "hub"]),
      readDiff: () => Promise.resolve(null),
      readScreenshot: () => Promise.resolve(null),
      refuseCredential: () => Promise.resolve(),
      requestUpdate: () => Promise.resolve(),
      runCommand,
      start: () => Promise.resolve({ id: "run-1", operationId: "op-1", state: "RUNNING" }),
      withinBudget: () => Promise.resolve(true),
      verifications: () => Promise.resolve([]),
      withLock,
    })

    expect(result).toBe("done")
    expect(runCommand).toHaveBeenCalledWith(
      ["score", "learning-1", "--operation-id", "op-1", "--store", "hub"],
      expect.objectContaining({ githubToken: "token" }),
    )
    expect(finish).toHaveBeenCalledWith("run-1", {
      state: "FAILED",
      failureCode: "copilot_failed",
      aiCredits: "1.5",
      copilotRequests: 2,
      finishedAt: new Date("2026-12-25T09:00:00Z"),
    })
    expect(deleteRequest).toHaveBeenCalledOnce()
  })

  it("pauses without scoring once the monthly budget is spent", async () => {
    const deleteRequest = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn(() => Promise.resolve({}))

    const result = await scoreAppliedLearnings({
      commitSha: "a".repeat(40),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest,
      finish: () => Promise.resolve(),
      hasPendingUserRun: () => Promise.resolve(false),
      isEnabled: () => Promise.resolve(true),
      now: () => new Date(),
      prepare: () => Promise.resolve([]),
      readDiff: () => Promise.resolve(null),
      readScreenshot: () => Promise.resolve(null),
      refuseCredential: () => Promise.resolve(),
      requestUpdate: () => Promise.resolve(),
      runCommand,
      start: () => Promise.resolve({ id: "run-1", operationId: "op-1", state: "RUNNING" }),
      withinBudget: () => Promise.resolve(false),
      verifications: () => Promise.resolve([]),
      withLock,
    })

    expect(result).toBe("paused")
    expect(runCommand).not.toHaveBeenCalled()
    expect(deleteRequest).not.toHaveBeenCalled()
  })

  it("leaves an interrupted score running so the next pass retries it", async () => {
    const finish = vi.fn(() => Promise.resolve())
    const deleteRequest = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn((arguments_: string[]) => {
      if (arguments_[0] === "usage") {
        return Promise.resolve({
          reports: [{ used: [{ id: "learning-1", memoryId: "memory-learning-1" }] }],
        })
      }
      return Promise.reject(new LearningCommandError("cancelled", "The worker stopped."))
    })

    await expect(
      scoreAppliedLearnings({
        commitSha: "a".repeat(40),
        credential: () => Promise.resolve({ githubToken: "token" }),
        deleteRequest,
        finish,
        hasPendingUserRun: () => Promise.resolve(false),
        isEnabled: () => Promise.resolve(true),
        now: () => new Date(),
        prepare: () => Promise.resolve([]),
        readDiff: () => Promise.resolve(null),
        readScreenshot: () => Promise.resolve(null),
        refuseCredential: () => Promise.resolve(),
        requestUpdate: () => Promise.resolve(),
        runCommand,
        start: () => Promise.resolve({ id: "run-1", operationId: "op-1", state: "RUNNING" }),
        withinBudget: () => Promise.resolve(true),
        verifications: () => Promise.resolve([]),
        withLock,
      }),
    ).rejects.toMatchObject({ code: "cancelled" })
    expect(finish).not.toHaveBeenCalled()
    expect(deleteRequest).not.toHaveBeenCalled()
  })

  it("scores a learning once more only with its own prototype's verification", async () => {
    const requestUpdate = vi.fn(() => Promise.resolve())
    const start = vi.fn((usedLearningId: string, trigger: string) =>
      Promise.resolve({ id: `run-${trigger}`, operationId: `op-${trigger}`, state: "RUNNING" }),
    )
    const runCommand = vi.fn((arguments_: string[]) => {
      if (arguments_[0] === "usage") {
        return Promise.resolve({
          reports: [
            {
              prototypeId: "prototype-2",
              used: [{ id: "learning-1", memoryId: "memory-learning-1" }],
            },
            {
              prototypeId: "prototype-1",
              used: [{ id: "learning-2", memoryId: "memory-learning-2" }],
            },
          ],
        })
      }
      return Promise.resolve({
        score: { id: "score-1", memoryId: `memory-${arguments_[1]}` },
        usage: { requests: 1, nanoAiu: 0 },
      })
    })

    await scoreAppliedLearnings({
      commitSha: "a".repeat(40),
      credential: () => Promise.resolve({ githubToken: "token" }),
      deleteRequest: () => Promise.resolve(),
      finish: () => Promise.resolve(),
      hasPendingUserRun: () => Promise.resolve(false),
      isEnabled: () => Promise.resolve(true),
      now: () => new Date(),
      prepare: () => Promise.resolve([]),
      readDiff: () => Promise.resolve(null),
      readScreenshot: () => Promise.resolve(null),
      refuseCredential: () => Promise.resolve(),
      requestUpdate,
      runCommand,
      start,
      withinBudget: () => Promise.resolve(true),
      verifications: () =>
        Promise.resolve([
          { prototypeId: "prototype-1", verifiedAt: new Date("2026-12-03T10:00:00.250Z") },
        ]),
      withLock,
    })

    expect(start.mock.calls).toEqual([
      ["learning-1", "USAGE"],
      ["learning-2", "USAGE"],
      ["learning-2", "REVIEWER_VERIFICATION"],
    ])
    expect(runCommand).toHaveBeenLastCalledWith(
      [
        "score",
        "learning-2",
        "--operation-id",
        "op-REVIEWER_VERIFICATION",
        "--reviewer-verified-at",
        "2026-12-03T10:00:00.250Z",
      ],
      expect.anything(),
    )
    // Each new score asks the daily job to check its learning's wording.
    expect(requestUpdate.mock.calls).toEqual([
      ["memory-learning-1"],
      ["memory-learning-2"],
      ["memory-learning-2"],
    ])
  })

  it("keeps the run open when the score names a different learning than the one used", async () => {
    const finish = vi.fn(() => Promise.resolve())
    const requestUpdate = vi.fn(() => Promise.resolve())
    const runCommand = vi.fn((arguments_: string[]) => {
      if (arguments_[0] === "usage") {
        return Promise.resolve({
          reports: [{ used: [{ id: "learning-1", memoryId: "memory-learning-1" }] }],
        })
      }
      return Promise.resolve({
        score: { id: "score-1", memoryId: "memory-other" },
        usage: { requests: 1, nanoAiu: 0 },
      })
    })

    await expect(
      scoreAppliedLearnings({
        commitSha: "a".repeat(40),
        credential: () => Promise.resolve({ githubToken: "token" }),
        deleteRequest: () => Promise.resolve(),
        finish,
        hasPendingUserRun: () => Promise.resolve(false),
        isEnabled: () => Promise.resolve(true),
        now: () => new Date(),
        prepare: () => Promise.resolve([]),
        readDiff: () => Promise.resolve(null),
        readScreenshot: () => Promise.resolve(null),
        refuseCredential: () => Promise.resolve(),
        requestUpdate,
        runCommand,
        start: () => Promise.resolve({ id: "run-1", operationId: "op-1", state: "RUNNING" }),
        withinBudget: () => Promise.resolve(true),
        verifications: () => Promise.resolve([]),
        withLock,
      }),
    ).rejects.toThrow("different learning")
    expect(requestUpdate).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })
})

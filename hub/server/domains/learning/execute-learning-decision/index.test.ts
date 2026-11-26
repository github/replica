import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root"
import { executeLearningDecision } from "."

vi.mock("../../../integrations/learning/run-learning-command", () => ({
  runLearningCommand: vi.fn(),
}))
vi.mock("../../../utils/validate-private-storage-root", () => ({
  validatePrivateStorageRoot: vi.fn(),
}))

describe("executeLearningDecision()", () => {
  it("accepts a database learning without creating a local store", async () => {
    const directory = resolve(`server/domains/learning/.decision-test-${randomUUID()}`)
    const learningDatabaseUrl = "postgresql://learning.example/replica"
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue(directory)
    vi.mocked(runLearningCommand).mockResolvedValue({})

    const result = await executeLearningDecision({
      actor: "human:mona",
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      decision: { decision: "accept", digest: `sha256:${"a".repeat(64)}` },
      learningDatabaseUrl,
      learningId: "mem_1",
      nodePath: "/node",
      operationId: "22222222-2222-4222-8222-222222222222",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result.notice).toBe("Learning accepted.")
    const [arguments_, options] = vi.mocked(runLearningCommand).mock.calls[0]!
    expect(arguments_).toEqual(expect.arrayContaining(["accept", "mem_1"]))
    expect(arguments_).not.toContain(learningDatabaseUrl)
    expect(options).toMatchObject({ learningDatabaseUrl })
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("passes a dash-leading reason through a private file instead of process arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "replica-learning-decision-test-"))
    try {
      await writeFile(join(directory, "config.json"), "{}")
      vi.mocked(validatePrivateStorageRoot).mockResolvedValue(directory)
      vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
        expect(arguments_).not.toContain("-private repository context")
        expect(arguments_).toEqual(
          expect.arrayContaining([
            "--repository",
            "github.com/repositories/123",
            "--legacy-repository",
            "github.com/repositories/11111111-2222-4333-8444-555555555555",
          ]),
        )
        const index = arguments_.indexOf("--reason-file")
        expect(index).toBeGreaterThan(-1)
        const path = arguments_[index + 1]
        if (!path) throw new Error("Expected reason file path.")
        expect(await readFile(path, "utf8")).toBe("-private repository context")
        return {}
      })

      await expect(
        executeLearningDecision({
          actor: "human:mona",
          applicationRoot: "/app",
          cliPath: "/app/replica-learning.mjs",
          decision: { decision: "retire", reason: "-private repository context" },
          learningId: "mem_1",
          nodePath: "/node",
          operationId: "22222222-2222-4222-8222-222222222222",
          repositoryId: "11111111-2222-4333-8444-555555555555",
          repositoryScope: "github.com/repositories/123",
          root: "/private/learning",
          staticDirectories: [],
        }),
      ).resolves.toEqual({ notice: "Learning retired." })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("propagates an inaccessible store so durable reconciliation stays pending", async () => {
    vi.mocked(validatePrivateStorageRoot).mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    )

    await expect(
      executeLearningDecision({
        actor: "human:mona",
        applicationRoot: "/app",
        cliPath: "/app/replica-learning.mjs",
        decision: { decision: "retire", reason: "obsolete" },
        learningId: "mem_1",
        nodePath: "/node",
        operationId: "22222222-2222-4222-8222-222222222222",
        repositoryId: "11111111-2222-4333-8444-555555555555",
        repositoryScope: "github.com/repositories/123",
        root: "/private/learning",
        staticDirectories: [],
      }),
    ).rejects.toMatchObject({ code: "EACCES" })
  })

  it("passes an accepted learning edit and its private text to the command", async () => {
    let reasonPath = ""
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repository")
    vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
      expect(arguments_).toEqual(
        expect.arrayContaining([
          "edit",
          "mem_1",
          "--digest",
          `sha256:${"a".repeat(64)}`,
          "--operation-id",
          "22222222-2222-4222-8222-222222222222",
          "--by",
          "human:mona",
        ]),
      )
      for (const [flag, text] of [
        ["--title-file", "Labels stay visible"],
        ["--content-file", "Show labels above each field."],
        ["--reason-file", "Clarify the guidance."],
      ] as const) {
        expect(arguments_).not.toContain(text)
        const index = arguments_.indexOf(flag)
        expect(index).toBeGreaterThan(-1)
        const path = arguments_[index + 1]!
        expect(await readFile(path, "utf8")).toBe(text)
        expect((await stat(path)).mode & 0o077).toBe(0)
        if (flag === "--reason-file") reasonPath = path
      }
      return {}
    })

    await executeLearningDecision({
      actor: "human:mona",
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      decision: {
        decision: "edit",
        digest: `sha256:${"a".repeat(64)}`,
        title: "Labels stay visible",
        content: "Show labels above each field.",
        reason: "Clarify the guidance.",
      },
      learningDatabaseUrl: "postgresql://learning.example/replica",
      learningId: "mem_1",
      nodePath: "/node",
      operationId: "22222222-2222-4222-8222-222222222222",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })
    expect(reasonPath).not.toBe("")
    await expect(stat(reasonPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("passes the reviewed digest and reason when reinstating a learning", async () => {
    let reasonPath = ""
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repository")
    vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
      expect(arguments_).toEqual(
        expect.arrayContaining([
          "reinstate",
          "mem_1",
          "--digest",
          `sha256:${"b".repeat(64)}`,
          "--operation-id",
          "33333333-3333-4333-8333-333333333333",
          "--by",
          "human:mona",
        ]),
      )
      expect(arguments_).not.toContain("The team confirmed the guidance.")
      const index = arguments_.indexOf("--reason-file")
      expect(index).toBeGreaterThan(-1)
      reasonPath = arguments_[index + 1]!
      expect(await readFile(reasonPath, "utf8")).toBe("The team confirmed the guidance.")
      return {}
    })

    await executeLearningDecision({
      actor: "human:mona",
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      decision: {
        decision: "reinstate",
        digest: `sha256:${"b".repeat(64)}`,
        reason: "The team confirmed the guidance.",
      },
      learningDatabaseUrl: "postgresql://learning.example/replica",
      learningId: "mem_1",
      nodePath: "/node",
      operationId: "33333333-3333-4333-8333-333333333333",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })
    expect(reasonPath).not.toBe("")
    await expect(stat(reasonPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("applies a suggested update with its operation ID and private wording", async () => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repository")
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce({ updates: [{ id: "upd_1", state: "open" }] })
      .mockImplementationOnce(async (arguments_) => {
        expect(arguments_).toEqual(
          expect.arrayContaining([
            "apply-update",
            "upd_1",
            "--operation-id",
            "33333333-3333-4333-8333-333333333333",
          ]),
        )
        const index = arguments_.indexOf("--content-file")
        expect(await readFile(arguments_[index + 1]!, "utf8")).toBe("Put labels above inputs.")
        return {}
      })

    const result = await executeLearningDecision({
      actor: "human:mona",
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      decision: {
        decision: "apply_update",
        proposalId: "upd_1",
        content: "Put labels above inputs.",
        reason: "The suggestion matches what reviewers asked for.",
      },
      learningDatabaseUrl: "postgresql://learning.example/replica",
      learningId: "mem_1",
      nodePath: "/node",
      operationId: "33333333-3333-4333-8333-333333333333",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result.notice).toBe("Suggested update applied.")
    expect(vi.mocked(runLearningCommand).mock.calls[0]![0]).toEqual(
      expect.arrayContaining(["updates", "mem_1"]),
    )
  })

  it("refuses a suggested update that belongs to another learning", async () => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repository")
    vi.mocked(runLearningCommand)
      .mockReset()
      .mockResolvedValueOnce({ updates: [{ id: "upd_1", state: "open" }] })

    await expect(
      executeLearningDecision({
        actor: "human:mona",
        applicationRoot: "/app",
        cliPath: "/app/replica-learning.mjs",
        decision: { decision: "dismiss_update", proposalId: "upd_other", reason: "Not needed." },
        learningDatabaseUrl: "postgresql://learning.example/replica",
        learningId: "mem_1",
        nodePath: "/node",
        operationId: "33333333-3333-4333-8333-333333333333",
        repositoryId: "11111111-2222-4333-8444-555555555555",
        repositoryScope: "github.com/repositories/123",
        root: "/private/learning",
        staticDirectories: [],
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    expect(runLearningCommand).toHaveBeenCalledTimes(1)
  })

  it("refuses a suggested update another administrator already decided", async () => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repository")
    vi.mocked(runLearningCommand)
      .mockReset()
      .mockResolvedValueOnce({ updates: [{ id: "upd_1", state: "applied" }] })

    await expect(
      executeLearningDecision({
        actor: "human:mona",
        applicationRoot: "/app",
        cliPath: "/app/replica-learning.mjs",
        decision: {
          decision: "apply_update",
          proposalId: "upd_1",
          content: "Put labels above inputs.",
          reason: "The suggestion matches what reviewers asked for.",
        },
        learningDatabaseUrl: "postgresql://learning.example/replica",
        learningId: "mem_1",
        nodePath: "/node",
        operationId: "33333333-3333-4333-8333-333333333333",
        repositoryId: "11111111-2222-4333-8444-555555555555",
        repositoryScope: "github.com/repositories/123",
        root: "/private/learning",
        staticDirectories: [],
      }),
    ).rejects.toMatchObject({ code: "stale_review" })
    expect(runLearningCommand).toHaveBeenCalledTimes(1)
  })
})

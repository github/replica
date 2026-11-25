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
})

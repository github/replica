import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  it("passes a dash-leading reason through a private file instead of process arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "replica-learning-decision-test-"))
    try {
      await writeFile(join(directory, "config.json"), "{}")
      vi.mocked(validatePrivateStorageRoot).mockResolvedValue(directory)
      vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
        expect(arguments_).not.toContain("-private repository context")
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
        root: "/private/learning",
        staticDirectories: [],
      }),
    ).rejects.toMatchObject({ code: "EACCES" })
  })
})

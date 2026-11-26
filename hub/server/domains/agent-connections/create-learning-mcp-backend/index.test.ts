import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, onTestFinished, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { createLearningMcpBackend } from "."

const runLearningCommand = vi.hoisted(() => vi.fn())
vi.mock("../../../integrations/learning/run-learning-command/index.ts", () => ({
  runLearningCommand,
}))

it("keeps server details out of what agents see when the store fails", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockRejectedValueOnce(
    new LearningCommandError("storage_corrupt", `The store at ${root} is damaged.`),
  )
  const backend = createLearningMcpBackend({
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  const failure = backend.listLearnings({})

  await expect(failure).rejects.toBeInstanceOf(LearningCommandError)
})

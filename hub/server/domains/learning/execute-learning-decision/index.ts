import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import type { LearningDecision } from "../types.ts"

export async function executeLearningDecision(input: {
  actor: string
  applicationRoot?: string
  cliPath: string
  decision: LearningDecision
  learningId: string
  nodePath: string
  operationId: string
  repositoryId: string
  root: string
  signal?: AbortSignal
  staticDirectories: string[]
}) {
  const applicationRoot = input.applicationRoot ?? process.cwd()
  const directory = await validatePrivateStorageRoot(
    resolve(input.root, "repositories", input.repositoryId),
    {
      applicationRoot,
      excludedDirectories: input.staticDirectories,
      name: "REPLICA_LEARNING_ROOT",
      publicRoot: resolve(applicationRoot, "public"),
    },
  )
  try {
    await access(resolve(directory, "config.json"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    throw new LearningCommandError("not_found", "That learning no longer exists.")
  }
  const arguments_ = [input.decision.decision, input.learningId]
  arguments_.push("--operation-id", input.operationId)
  if (input.decision.decision !== "retire") {
    arguments_.push("--digest", input.decision.digest)
  }
  arguments_.push("--by", input.actor)
  let temporaryDirectory: string | undefined
  try {
    if (input.decision.decision !== "accept") {
      temporaryDirectory = await mkdtemp(resolve(tmpdir(), "replica-learning-decision-"))
      const reasonPath = resolve(temporaryDirectory, "reason.txt")
      await writeFile(reasonPath, input.decision.reason, { mode: 0o600 })
      arguments_.push("--reason-file", reasonPath)
    }
    if (input.decision.decision === "accept" && input.decision.content !== undefined) {
      temporaryDirectory = await mkdtemp(resolve(tmpdir(), "replica-learning-decision-"))
      const contentPath = resolve(temporaryDirectory, "content.txt")
      await writeFile(contentPath, input.decision.content, { mode: 0o600 })
      arguments_.push("--content-file", contentPath)
    }
    await runLearningCommand(
      [
        ...arguments_,
        "--dir",
        directory,
        "--repository",
        `github.com/repositories/${input.repositoryId}`,
      ],
      {
        cliPath: input.cliPath,
        nodePath: input.nodePath,
        signal: input.signal,
      },
    )
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true })
  }
  return {
    notice:
      input.decision.decision === "accept"
        ? "Learning accepted."
        : input.decision.decision === "reject"
          ? "Suggestion rejected."
          : "Learning retired.",
  }
}

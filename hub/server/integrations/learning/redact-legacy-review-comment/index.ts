import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../run-learning-command/index.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"

export async function redactLegacyReviewComment(
  input: { repositoryId: string; commentId: number; actor: string },
  options: {
    root: string
    staticDirectories: string[]
    cliPath: string
    nodePath: string
    signal: AbortSignal
  },
) {
  const repositoryId = z.uuid().parse(input.repositoryId)
  const directory = await validatePrivateStorageRoot(
    resolve(options.root, "repositories", repositoryId),
    {
      applicationRoot: process.cwd(),
      excludedDirectories: options.staticDirectories,
      name: "REPLICA_LEARNING_ROOT",
      publicRoot: resolve(process.cwd(), "public"),
    },
  )
  return await runLearningCommand(
    [
      "redact",
      "--comment",
      String(input.commentId),
      "--by",
      input.actor,
      "--dir",
      directory,
      "--legacy-repository",
      `github.com/repositories/${repositoryId}`,
      "--legacy-redaction",
    ],
    { cliPath: options.cliPath, nodePath: options.nodePath, signal: options.signal },
  )
}

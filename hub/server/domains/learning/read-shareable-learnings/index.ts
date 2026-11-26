import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"

const memorySchema = z
  .object({
    withheld: z.boolean(),
    record: z
      .object({
        id: z.string().min(1),
        title: z.string().optional(),
        content: z.string().optional(),
      })
      .loose(),
    status: z.object({ recallEligible: z.boolean(), problems: z.array(z.string()) }).loose(),
  })
  .loose()

/**
 * Reads the learnings a repository could share: accepted, intact and given to its own
 * agents. Other repositories receive the full record, so recall can check it is unchanged.
 */
export async function readShareableLearnings(input: {
  applicationRoot?: string
  cliPath: string
  learningDatabaseUrl?: string
  learningIds: string[]
  nodePath: string
  repositoryId: string
  repositoryScope: string
  root: string
  staticDirectories: string[]
  timeoutMs?: number
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
  if (!input.learningDatabaseUrl) {
    try {
      await access(resolve(directory, "config.json"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return []
    }
  }
  const raw = await runLearningCommand(
    [
      "memories",
      "--state",
      "accepted",
      ...learningStoreArguments({
        directory,
        repositoryId: input.repositoryId,
        repositoryScope: input.repositoryScope,
      }),
    ],
    {
      cliPath: input.cliPath,
      nodePath: input.nodePath,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.learningDatabaseUrl ? { learningDatabaseUrl: input.learningDatabaseUrl } : {}),
    },
  )
  const wanted = new Set(input.learningIds)
  return z
    .array(memorySchema)
    .parse(raw)
    .filter(
      (item) =>
        wanted.has(item.record.id) &&
        !item.withheld &&
        item.status.recallEligible &&
        item.status.problems.length === 0,
    )
    .map((item) => item.record)
}

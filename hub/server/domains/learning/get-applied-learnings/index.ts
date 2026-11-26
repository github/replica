import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import type { AppliedLearning } from "../types.ts"

const screenshotSchema = z
  .object({ sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/), route: z.string() })
  .loose()
const usageSchema = z
  .object({
    reports: z.array(
      z
        .object({
          prototypeId: z.string().optional(),
          used: z.array(
            z
              .object({
                memoryId: z.string().min(1),
                version: z.number().int().positive().nullable(),
                title: z.string().nullable(),
                before: screenshotSchema.optional(),
                after: screenshotSchema.optional(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
  })
  .loose()

/**
 * Lists the learnings agents said they applied in one prototype's commit. Reports are
 * matched by exact commit only, never by branch or time, so a Build shows only what was
 * reported for the code it was built from. A report that names another prototype is left
 * out. A report that names none counts for every prototype built from that commit.
 */
export async function getAppliedLearnings(input: {
  applicationRoot?: string
  cliPath: string
  commitSha: string
  learningDatabaseUrl?: string
  nodePath: string
  prototypeId: string
  repositoryId: string
  repositoryScope: string
  root: string
  staticDirectories: string[]
}): Promise<AppliedLearning[]> {
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
  const { reports } = usageSchema.parse(
    await runLearningCommand(
      [
        "usage",
        "--commit",
        input.commitSha,
        ...learningStoreArguments({
          directory,
          repositoryId: input.repositoryId,
          repositoryScope: input.repositoryScope,
        }),
      ],
      {
        cliPath: input.cliPath,
        nodePath: input.nodePath,
        ...(input.learningDatabaseUrl ? { learningDatabaseUrl: input.learningDatabaseUrl } : {}),
      },
    ),
  )
  // A learning reported twice for the same commit is listed once, as last reported.
  const applied = new Map<string, AppliedLearning>()
  for (const report of reports) {
    if (report.prototypeId !== undefined && report.prototypeId !== input.prototypeId) continue
    for (const used of report.used) {
      applied.delete(used.memoryId)
      applied.set(used.memoryId, {
        id: used.memoryId,
        title: used.title,
        version: used.version,
        ...(used.before ? { before: screenshot(used.before) } : {}),
        ...(used.after ? { after: screenshot(used.after) } : {}),
      })
    }
  }
  return [...applied.values()]
}

function screenshot(value: z.infer<typeof screenshotSchema>) {
  return { sha256: value.sha256.slice("sha256:".length), route: value.route }
}

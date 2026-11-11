import { constants } from "node:fs"
import { chmod, mkdir, open } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"

const repositoryKeySchema = z.uuid()
const repositoryScopeSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[a-z0-9.-]+\/repositories\/[A-Za-z0-9_-]+$/)

export async function prepareLearningStore({
  applicationRoot = process.cwd(),
  repositoryKey,
  repositoryScope,
  root,
}: {
  applicationRoot?: string
  repositoryKey: string
  repositoryScope: string
  root: string
}) {
  const key = repositoryKeySchema.parse(repositoryKey)
  const scope = repositoryScopeSchema.parse(repositoryScope)
  const directory = await validatePrivateStorageRoot(resolve(root, "repositories", key), {
    applicationRoot,
    name: "REPLICA_LEARNING_ROOT",
    publicRoot: resolve(applicationRoot, "public"),
  })
  await mkdir(directory, { mode: 0o700, recursive: true })
  await chmod(directory, 0o700)
  const configurationPath = resolve(directory, "config.json")
  try {
    const handle = await open(
      configurationPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await handle.writeFile(
        `${JSON.stringify(
          {
            schemaVersion: "replica.learning-config/v1",
            consolidation: {
              options: {
                signals: ["visual_quality", "accessibility", "usability", "content", "interaction"],
              },
            },
          },
          null,
          2,
        )}\n`,
      )
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  return { directory, repositoryScope: scope }
}

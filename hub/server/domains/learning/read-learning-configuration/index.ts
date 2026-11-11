import { resolve } from "node:path"

import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"

export async function readLearningConfiguration(
  environment: NodeJS.ProcessEnv,
  applicationRoot = process.cwd(),
) {
  const root = await validatePrivateStorageRoot(
    environment.REPLICA_LEARNING_ROOT ?? "storage/learning",
    {
      applicationRoot,
      name: "REPLICA_LEARNING_ROOT",
      publicRoot: resolve(applicationRoot, "public"),
    },
  )
  const cliPath = resolve(
    applicationRoot,
    environment.REPLICA_LEARNING_CLI ?? "../packages/learning/bin/replica-learning.mjs",
  )
  const nodePath = environment.REPLICA_LEARNING_NODE?.trim() || process.execPath
  return {
    cliPath,
    copilotToken: environment.REPLICA_COPILOT_TOKEN?.trim() || null,
    nodePath,
    root,
  }
}

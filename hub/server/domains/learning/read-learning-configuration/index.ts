import { resolve } from "node:path"

import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { createCopilotCredentialProvider } from "../../copilot-credentials/create-copilot-credential-provider/index.ts"
import { LearningConfigurationError } from "../errors.ts"

export async function readLearningConfiguration(
  environment: NodeJS.ProcessEnv,
  applicationRoot = process.cwd(),
) {
  const automaticRunsValue = environment.REPLICA_LEARNING_AUTOMATIC_RUNS?.trim().toLowerCase()
  if (
    automaticRunsValue !== undefined &&
    automaticRunsValue !== "true" &&
    automaticRunsValue !== "false"
  ) {
    throw new LearningConfigurationError("REPLICA_LEARNING_AUTOMATIC_RUNS must be true or false.")
  }
  const clientDirectory = environment.CLIENT_DIRECTORY?.trim()
  let root: string
  try {
    root = await validatePrivateStorageRoot(
      environment.REPLICA_LEARNING_ROOT ?? "storage/learning",
      {
        applicationRoot,
        excludedDirectories: clientDirectory ? [clientDirectory] : [],
        name: "REPLICA_LEARNING_ROOT",
        publicRoot: resolve(applicationRoot, "public"),
      },
    )
  } catch (error) {
    throw new LearningConfigurationError(
      error instanceof Error ? error.message : "REPLICA_LEARNING_ROOT is invalid.",
      { cause: error },
    )
  }
  const cliPath = resolve(
    applicationRoot,
    environment.REPLICA_LEARNING_CLI ?? "../packages/learning/bin/replica-learning.mjs",
  )
  const nodePath = environment.REPLICA_LEARNING_NODE?.trim() || process.execPath
  let copilotCredentialProvider
  try {
    copilotCredentialProvider = createCopilotCredentialProvider(environment)
  } catch (error) {
    throw new LearningConfigurationError(
      error instanceof Error ? error.message : "Copilot credential configuration is invalid.",
      { cause: error },
    )
  }
  return {
    automaticRuns: automaticRunsValue === "true",
    cliPath,
    copilotCredentialProvider,
    nodePath,
    root,
    staticDirectories: [
      resolve(applicationRoot, "public"),
      ...(clientDirectory ? [resolve(clientDirectory)] : []),
    ],
  }
}

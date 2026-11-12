import { resolve } from "node:path"

import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import type { GitHubAppJwtSigner } from "../../../integrations/github/create-github-app-jwt-signer/types.ts"
import { createCopilotCredentialProvider } from "../../copilot-credentials/create-copilot-credential-provider/index.ts"
import { LearningConfigurationError } from "../errors.ts"

export async function readLearningConfiguration(
  environment: NodeJS.ProcessEnv,
  applicationRoot = process.cwd(),
  dependencies: { githubAppJwtSigner?: GitHubAppJwtSigner } = {},
) {
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
    copilotCredentialProvider = createCopilotCredentialProvider(environment, dependencies)
  } catch (error) {
    throw new LearningConfigurationError(
      error instanceof Error ? error.message : "Copilot credential configuration is invalid.",
      { cause: error },
    )
  }
  return {
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

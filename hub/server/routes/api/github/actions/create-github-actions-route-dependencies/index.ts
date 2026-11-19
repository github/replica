import { createRemoteJWKSet } from "jose"

import { replicaWorkflowPath } from "../../../../../domains/github-builds/constants.ts"
import { receiveGitHubBuildPush } from "../../../../../domains/github-builds/receive-github-build-push/index.ts"
import { receiveGitHubScreenshotPush } from "../../../../../domains/github-builds/receive-github-screenshot-push/index.ts"
import type { GitHubBuildImportDependencies } from "../../../../../domains/github-builds/types.ts"
import { createGitHubActionsClient } from "../../../../../integrations/github/create-github-actions-client/index.ts"
import type { GitHubActionsClientInput } from "../../../../../integrations/github/create-github-actions-client/types.ts"
import { githubActionsJwksUrl } from "../../../../../integrations/github/verify-github-actions-token/constants.ts"
import { verifyGitHubActionsToken } from "../../../../../integrations/github/verify-github-actions-token/index.ts"
import type { GitHubActionsRouteDependencies } from "../types.ts"

/** Tokens must name this Hub's origin as their audience, so they cannot be replayed elsewhere. */
export function createGitHubActionsRouteDependencies(
  input: GitHubBuildImportDependencies & {
    applicationOrigin: string
    appCredentials: Omit<GitHubActionsClientInput, "githubRepositoryId">
  },
): GitHubActionsRouteDependencies {
  const keys = createRemoteJWKSet(new URL(githubActionsJwksUrl))
  return {
    verifyToken: (token) =>
      verifyGitHubActionsToken(token, {
        audience: input.applicationOrigin,
        keys,
        workflowPath: replicaWorkflowPath,
      }),
    receiveBuild: (run, bytes) =>
      receiveGitHubBuildPush(
        {
          ...input,
          client: createGitHubActionsClient({
            ...input.appCredentials,
            githubRepositoryId: run.githubRepositoryId,
          }),
        },
        run,
        bytes,
      ),
    receiveScreenshots: (run, bytes) => receiveGitHubScreenshotPush(input, run, bytes),
  }
}

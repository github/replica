import type { GitHubActionsRunIdentity } from "../../../integrations/github/verify-github-actions-token/types.ts"
import { findGitHubBuild } from "../../../repositories/github-builds/find-github-build/index.ts"
import { importGitHubScreenshotPackage } from "../import-github-screenshot-package/index.ts"
import type { GitHubBuildImportDependencies } from "../types.ts"

/**
 * Attaches screenshots pushed by a verified workflow run to its commit's Build. They are
 * accepted only when they depict the Build's stored dist.
 */
export async function receiveGitHubScreenshotPush(
  dependencies: GitHubBuildImportDependencies,
  identity: GitHubActionsRunIdentity,
  bytes: Buffer,
) {
  const build = await findGitHubBuild(dependencies.database, identity)
  if (!build) return { status: "not-ready" as const }
  const result = await importGitHubScreenshotPackage(dependencies, build.id, bytes)
  return { ...result, buildId: build.id }
}

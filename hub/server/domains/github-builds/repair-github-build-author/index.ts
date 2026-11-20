import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { findGitHubBuildAuthorTarget } from "../../../repositories/github-builds/find-github-build-author-target/index.ts"
import { recordGitHubBuildAuthor } from "../../../repositories/github-builds/record-github-build-author/index.ts"
import { getGitHubBuildAuthorAction } from "../../../utils/get-github-build-author-action/index.ts"
import { GitHubBuildAuthorTargetError } from "../errors.ts"

/** Explicitly repairs one retained Build, including those outside the recovery window. */
export async function repairGitHubBuildAuthor(
  dependencies: {
    database: PrismaClient
    client: Pick<ReturnType<typeof createGitHubActionsClient>, "getCommitAuthor">
    logger: Pick<Logger, "warn">
  },
  input: { buildId: string; githubRepositoryId: number; apply: boolean },
) {
  const target = await findGitHubBuildAuthorTarget(dependencies.database, input)
  if (!target?.commitSha || target.githubWorkflowRunId === null) {
    throw new GitHubBuildAuthorTargetError()
  }
  const author = await dependencies.client.getCommitAuthor(target.commitSha)
  if (!author) {
    dependencies.logger.warn(
      { buildId: target.id, commitSha: target.commitSha },
      "GitHub commit has no linked author",
    )
    return { status: "unavailable" as const }
  }
  if (!input.apply) {
    return {
      status: "available" as const,
      author,
      build: getGitHubBuildAuthorAction(target, author),
      prototypeOwner: "unchanged" as const,
    }
  }
  return recordGitHubBuildAuthor(dependencies.database, {
    buildId: target.id,
    commitSha: target.commitSha,
    githubRepositoryId: input.githubRepositoryId,
    githubWorkflowRunId: target.githubWorkflowRunId,
    author,
  })
}

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { GitHubProviderRequestError } from "../../../integrations/github/errors.ts"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build/index.ts"
import { recordGitHubBuildAuthor } from "../../../repositories/github-builds/record-github-build-author/index.ts"
import type { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { isGitHubWorkflowBranchPush } from "../is-github-workflow-branch-push/index.ts"

/**
 * Finds or creates the Build for a Replica workflow branch push run, using GitHub's
 * record of the run so webhook and pushed imports order runs the same way.
 */
export async function prepareGitHubWorkflowRunBuild(
  database: PrismaClient,
  githubRepositoryId: number,
  run: GitHubWorkflowRun,
  workflowPaths: string[],
  getCommitAuthor: ReturnType<typeof createGitHubActionsClient>["getCommitAuthor"],
) {
  if (
    !isGitHubWorkflowBranchPush(githubRepositoryId, run) ||
    !workflowPaths.includes(run.path.split("@")[0] ?? "")
  ) {
    return { status: "ignored" as const }
  }
  const buildRun = {
    runId: BigInt(run.id),
    runAttempt: run.runAttempt,
    workflowUrl: run.htmlUrl,
    createdAt: run.createdAt,
  }
  const prepared = await prepareGitHubBuild(database, {
    githubRepositoryId,
    branchName: run.headBranch,
    commitSha: run.headSha,
    run: buildRun,
    author: null,
  })
  if (prepared.status !== "ready") return prepared
  const saved = await database.build.findFirst({
    where: {
      id: prepared.buildId,
      commitSha: run.headSha,
      prototype: {
        repository: { githubRepositoryId: BigInt(githubRepositoryId), removedAt: null },
      },
    },
    select: {
      githubWorkflowRunId: true,
      authorProvider: true,
      authorIssuer: true,
      authorProviderUserId: true,
      authorLogin: true,
      authorAvatarUrl: true,
    },
  })
  if (!saved) throw new Error("The Build or repository no longer matches the GitHub run.")
  const noIdentity =
    saved.authorProvider === null &&
    saved.authorIssuer === null &&
    saved.authorProviderUserId === null
  const savedGitHubIdentity =
    saved.authorProvider === "github" &&
    saved.authorIssuer === "https://github.com" &&
    saved.authorProviderUserId
  let authorPreserved = !noIdentity && !savedGitHubIdentity
  let author: { providerUserId: string; login: string | null; avatarUrl: string | null } | null =
    null
  let authorError: GitHubProviderRequestError | undefined
  if (savedGitHubIdentity) {
    author = {
      providerUserId: savedGitHubIdentity,
      login: saved.authorLogin,
      avatarUrl: saved.authorAvatarUrl,
    }
  } else if (noIdentity) {
    try {
      author = await getCommitAuthor(run.headSha)
    } catch (error) {
      if (!(error instanceof GitHubProviderRequestError)) throw error
      authorError = error
    }
  }
  if (author) {
    const recorded = await recordGitHubBuildAuthor(database, {
      buildId: prepared.buildId,
      commitSha: run.headSha,
      githubRepositoryId,
      githubWorkflowRunId: saved.githubWorkflowRunId,
      author,
    })
    authorPreserved = recorded.status === "preserved"
  }
  return { ...prepared, buildRun, authorPreserved: Boolean(authorPreserved), authorError }
}

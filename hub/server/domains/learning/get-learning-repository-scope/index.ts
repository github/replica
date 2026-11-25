import type { Prisma } from "../../../generated/prisma/client.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { findRepositoryGitHubId } from "../../../repositories/repository-access/find-repository-github-id/index.ts"

export async function getLearningRepositoryScope(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
) {
  const repository = await findRepositoryGitHubId(database, repositoryId)
  const id = repository?.githubRepositoryId
  if (id == null || id <= 0n) {
    throw new LearningCommandError(
      "repository_scope_unavailable",
      "Learnings are unavailable because this repository has no GitHub repository ID.",
    )
  }
  return `github.com/repositories/${id}`
}

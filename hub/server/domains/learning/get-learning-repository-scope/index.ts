import type { Prisma } from "../../../generated/prisma/client.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"

export async function getLearningRepositoryScope(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
) {
  const repository = await database.repository.findUnique({
    where: { id: repositoryId },
    select: { githubRepositoryId: true },
  })
  const id = repository?.githubRepositoryId
  if (id == null || id <= 0n) {
    throw new LearningCommandError(
      "repository_scope_unavailable",
      "Learnings are unavailable because this repository has no GitHub repository ID.",
    )
  }
  return `github.com/repositories/${id}`
}

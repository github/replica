import type { Prisma } from "../../../generated/prisma/client.ts"

export async function readGitHubRepositoryAccessState(
  database: Pick<Prisma.TransactionClient, "gitHubRepositoryAccessState">,
) {
  return database.gitHubRepositoryAccessState.findUniqueOrThrow({
    select: { revision: true },
    where: { key: "global" },
  })
}

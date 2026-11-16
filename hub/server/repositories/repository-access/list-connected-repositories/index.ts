import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listConnectedRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
): Promise<Array<{ id: string; nameWithOwner: string }>> {
  return database.repository.findMany({
    orderBy: { nameWithOwner: "asc" },
    select: { id: true, nameWithOwner: true },
    where: { githubRepositoryId: { not: null }, removedAt: null },
  })
}

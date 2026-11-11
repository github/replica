import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listRepositories(database: Pick<Prisma.TransactionClient, "repository">) {
  return database.repository.findMany({
    where: { removedAt: null },
    select: { id: true, nameWithOwner: true, defaultBranch: true },
    orderBy: [{ nameWithOwner: "asc" }, { id: "asc" }],
  })
}

import type { Prisma } from "../../../generated/prisma/client.ts"
import type { ConnectedRepositoryEvidence } from "../types.ts"

/**
 * Records repositories the GitHub App can read. Rows are matched by GitHub ID,
 * then by name for rows created before IDs were stored. Returns Hub IDs in order.
 */
export async function upsertConnectedRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositories: ConnectedRepositoryEvidence[],
  options: { allowReconnect: boolean },
): Promise<string[]> {
  const ids: string[] = []
  for (const repository of repositories) {
    const githubRepositoryId = BigInt(repository.githubRepositoryId)
    const data = {
      defaultBranch: repository.defaultBranch,
      githubRepositoryId,
      nameWithOwner: repository.nameWithOwner,
      removedAt: null,
    }
    const existing =
      (await database.repository.findUnique({
        select: { id: true, removedAt: true },
        where: { githubRepositoryId },
      })) ??
      (await database.repository.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, removedAt: true },
        where: {
          githubRepositoryId: null,
          nameWithOwner: { equals: repository.nameWithOwner, mode: "insensitive" },
        },
      }))
    if (existing?.removedAt && !options.allowReconnect) {
      throw new Error("User evidence cannot reconnect a disconnected GitHub repository.")
    }
    const saved = existing
      ? await database.repository.update({ data, select: { id: true }, where: { id: existing.id } })
      : await database.repository.create({ data, select: { id: true } })
    ids.push(saved.id)
  }
  return ids
}

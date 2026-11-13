import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { containsText } from "../contains-text/index.ts"
import { reviewablePrototypeWhere } from "../reviewable-prototype-where/index.ts"

const pageSize = 20

export interface RepositoryAuthorsFilters {
  viewerId: string
  query: string
  after: { login: string; id: string } | null
}

/**
 * Lists users with prototypes in the index for the user filter. The viewer is
 * left out because the filter always offers them as "Me".
 */
export async function findRepositoryAuthors(
  database: Pick<PrismaClient, "repository" | "user">,
  repositoryId: string,
  filters: RepositoryAuthorsFilters,
) {
  const repository = await database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: { id: true, defaultBranch: true },
  })
  if (!repository) return null

  const search = filters.query ? containsText(filters.query) : null
  const profile: Prisma.UserProfileWhereInput = search
    ? { OR: [{ login: search }, { name: search }] }
    : {}
  const where: Prisma.UserWhereInput = {
    id: { not: filters.viewerId },
    prototypes: { some: reviewablePrototypeWhere(repository) },
    profile: { is: profile },
    ...(filters.after
      ? {
          OR: [
            { profile: { is: { login: { gt: filters.after.login } } } },
            { profile: { is: { login: filters.after.login } }, id: { gt: filters.after.id } },
          ],
        }
      : {}),
  }
  // Read one extra row to learn whether another page exists.
  const rows = await database.user.findMany({
    where,
    orderBy: [{ profile: { login: "asc" } }, { id: "asc" }],
    take: pageSize + 1,
    select: { id: true, profile: { select: { login: true, name: true, provider: true } } },
  })
  const authors = rows
    .slice(0, pageSize)
    .flatMap(({ id, profile }) => (profile ? [{ id, ...profile, avatarUrl: null }] : []))
  const last = authors.at(-1)
  return {
    authors,
    next: rows.length > pageSize && last ? { login: last.login, id: last.id } : null,
  }
}

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { containsText } from "../contains-text/index.ts"
import { reviewablePrototypeWhere } from "../reviewable-prototype-where/index.ts"

const pageSize = 24
const authorSelect = {
  id: true,
  profile: { select: { login: true, name: true, provider: true } },
} as const

export interface RepositoryIndexFilters {
  query: string
  authorId: string | null
  page: number
}

export async function findRepositoryIndex(
  database: Pick<PrismaClient, "$transaction" | "repository">,
  repositoryId: string,
  filters: RepositoryIndexFilters = { query: "", authorId: null, page: 1 },
) {
  const repository = await database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: { id: true, nameWithOwner: true, defaultBranch: true },
  })
  if (!repository) return null

  const eligible = reviewablePrototypeWhere(repository)
  const search = filters.query ? containsText(filters.query) : null
  const where: Prisma.PrototypeWhereInput = {
    ...eligible,
    ...(filters.authorId ? { authorId: filters.authorId } : {}),
    ...(search
      ? {
          OR: [
            { name: search },
            { description: search },
            { branchName: search },
            { author: { profile: { login: search } } },
            { author: { profile: { name: search } } },
          ],
        }
      : {}),
  }
  // Keep the count, page, and cards from the same database snapshot.
  const { records, totalCount, page, selectedAuthor } = await database.$transaction(
    async (transaction) => {
      const totalCount = await transaction.prototype.count({ where })
      // A page past the end shows the last page, as a shared link may outlive results.
      const page = Math.min(filters.page, Math.max(1, Math.ceil(totalCount / pageSize)))
      const records = await transaction.prototype.findMany({
        where,
        orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          repositoryId: true,
          name: true,
          description: true,
          branchName: true,
          author: { select: authorSelect },
        },
      })
      // Name the selected user even when no card on this page belongs to them.
      const selectedAuthor = filters.authorId
        ? await transaction.user.findFirst({
            where: { id: filters.authorId, prototypes: { some: eligible } },
            select: authorSelect,
          })
        : null
      return { records, totalCount, page, selectedAuthor }
    },
    { isolationLevel: "RepeatableRead" },
  )
  const currentRepository = await database.repository.findFirst({
    where: { id: repositoryId, removedAt: null, defaultBranch: repository.defaultBranch },
    select: { id: true },
  })
  if (!currentRepository) return null
  const authors = new Map<
    string,
    { id: string; login: string; name: string | null; provider: string; avatarUrl: null }
  >()
  function addAuthor(
    author: {
      id: string
      profile: { login: string; name: string | null; provider: string } | null
    } | null,
  ) {
    if (!author?.profile) return
    authors.set(author.id, { id: author.id, ...author.profile, avatarUrl: null })
  }
  addAuthor(selectedAuthor)
  const prototypes = records.map((record) => {
    if (!record.name) throw new Error("A registered prototype must have a name.")
    addAuthor(record.author)
    return {
      id: record.id,
      repositoryId: record.repositoryId,
      name: record.name,
      description: record.description,
      branchName: record.branchName,
      authorId: record.author?.id ?? null,
      authorLogin: record.author?.profile?.login ?? null,
      canEdit: false,
      builds: [],
    }
  })
  return {
    repository,
    prototypes,
    authors: [...authors.values()],
    pagination: {
      page,
      pageSize,
      totalCount,
      pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    },
  }
}

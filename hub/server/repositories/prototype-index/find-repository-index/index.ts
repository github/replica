import { Prisma, type BuildState, type PrismaClient } from "../../../generated/prisma/client.ts"
import { containsText } from "../contains-text/index.ts"
import { reviewablePrototypeWhere } from "../reviewable-prototype-where/index.ts"
import { type RepositoryScope, visibleRepositoryWhere } from "../visible-repository-where/index.ts"

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
  scope: RepositoryScope = null,
) {
  const repository = await database.repository.findFirst({
    where: { id: repositoryId, ...visibleRepositoryWhere(scope) },
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
  const {
    records,
    totalCount,
    page,
    selectedAuthor,
    latestBuilds: buildSummaries,
  } = await database.$transaction(
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
      // Prisma cannot order by COALESCE, so select fallback Builds in SQL.
      const latestBuilds =
        records.length > 0
          ? await transaction.$queryRaw<
              { prototypeId: string; number: number; state: BuildState }[]
            >(Prisma.sql`
              SELECT prototypes.id AS "prototypeId", latest_build.number, latest_build.state
              FROM prototypes
              LEFT JOIN LATERAL (
                SELECT builds.number, builds.state
                FROM builds
                WHERE builds.prototype_id = prototypes.id
                  AND (
                    prototypes.current_build_id IS NULL
                    OR builds.id = prototypes.current_build_id
                  )
                ORDER BY
                  COALESCE(builds.workflow_created_at, builds.created_at) DESC,
                  builds.number DESC
                LIMIT 1
              ) AS latest_build ON TRUE
              WHERE prototypes.id IN (${Prisma.join(
                records.map(({ id }) => Prisma.sql`${id}::uuid`),
              )})
                AND latest_build.number IS NOT NULL
            `)
          : []
      // Name the selected user even when no card on this page belongs to them.
      const selectedAuthor = filters.authorId
        ? await transaction.user.findFirst({
            where: { id: filters.authorId, prototypes: { some: eligible } },
            select: authorSelect,
          })
        : null
      return { records, totalCount, page, selectedAuthor, latestBuilds }
    },
    { isolationLevel: "RepeatableRead" },
  )
  const currentRepository = await database.repository.findFirst({
    where: {
      id: repositoryId,
      defaultBranch: repository.defaultBranch,
      ...visibleRepositoryWhere(scope),
    },
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
  const latestBuilds = new Map(
    buildSummaries.map(({ prototypeId, ...build }) => [prototypeId, build] as const),
  )
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
      latestBuild: latestBuilds.get(record.id) ?? null,
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

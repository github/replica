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
  buildArtifactUrl?: (
    buildId: string,
    repositoryId: string,
    prototypeId: string,
    buildNumber: number,
    target: "desktop",
  ) => string,
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
  }
  // Keep the count, page, and cards from the same database snapshot.
  const {
    records,
    totalCount,
    page,
    selectedAuthor,
    latestBuilds: buildSummaries,
    reviewBuilds,
  } = await database.$transaction(
    async (transaction) => {
      // Prisma cannot filter by the same COALESCE-ordered Build used by the card.
      const searchFrom = search
        ? Prisma.sql`
            FROM prototypes AS prototype
            LEFT JOIN user_profiles AS profile ON profile.user_id = prototype.author_id
            LEFT JOIN LATERAL (
              SELECT builds.author_provider, builds.author_login
              FROM builds
              WHERE builds.prototype_id = prototype.id
                AND (prototype.current_build_id IS NULL OR builds.id = prototype.current_build_id)
              ORDER BY COALESCE(builds.workflow_created_at, builds.created_at) DESC,
                builds.number DESC
              LIMIT 1
            ) AS author_build ON prototype.author_id IS NULL
            WHERE prototype.repository_id = ${repository.id}::uuid
              AND prototype.registered_at IS NOT NULL
              AND prototype.branch_deleted_at IS NULL
              AND NOT prototype.replica
              AND prototype.branch_name NOT IN (${repository.defaultBranch}, 'replica/install-workflow')
              ${filters.authorId ? Prisma.sql`AND prototype.author_id = ${filters.authorId}::uuid` : Prisma.empty}
              AND (
                prototype.name ILIKE ${`%${search.contains}%`}
                OR prototype.description ILIKE ${`%${search.contains}%`}
                OR prototype.branch_name ILIKE ${`%${search.contains}%`}
                OR profile.login ILIKE ${`%${search.contains}%`}
                OR profile.name ILIKE ${`%${search.contains}%`}
                OR (
                  prototype.author_id IS NULL AND author_build.author_provider = 'github'
                  AND author_build.author_login ILIKE ${`%${search.contains}%`}
                )
              )
          `
        : null
      let totalCount: number
      if (searchFrom) {
        const [count] = await transaction.$queryRaw<{ count: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS count ${searchFrom}`,
        )
        if (!count) throw new Error("The prototype search count was not returned.")
        totalCount = count.count
      } else {
        totalCount = await transaction.prototype.count({ where })
      }
      // A page past the end shows the last page, as a shared link may outlive results.
      const page = Math.min(filters.page, Math.max(1, Math.ceil(totalCount / pageSize)))
      const matchingIds = searchFrom
        ? (
            await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT prototype.id ${searchFrom}
              ORDER BY prototype.registered_at DESC, prototype.id DESC
              LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
            `)
          ).map(({ id }) => id)
        : null
      const records = await transaction.prototype.findMany({
        where: { ...where, ...(matchingIds ? { id: { in: matchingIds } } : {}) },
        orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
        skip: matchingIds ? 0 : (page - 1) * pageSize,
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
              {
                prototypeId: string
                number: number
                state: BuildState
                authorProvider: string | null
                authorLogin: string | null
              }[]
            >(Prisma.sql`
              SELECT prototypes.id AS "prototypeId", latest_build.number, latest_build.state,
                latest_build.author_provider AS "authorProvider",
                latest_build.author_login AS "authorLogin"
              FROM prototypes
              LEFT JOIN LATERAL (
                SELECT builds.number, builds.state, builds.author_provider, builds.author_login
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
      // Select one preview per card, preferring a saved screenshot over a newer Build without one.
      const reviewBuilds =
        buildArtifactUrl && records.length > 0
          ? await transaction.$queryRaw<
              { prototypeId: string; id: string; number: number; hasScreenshot: boolean }[]
            >(Prisma.sql`
              SELECT prototypes.id AS "prototypeId", review_build.*
              FROM prototypes
              JOIN LATERAL (
                SELECT builds.id, builds.number, (screenshot.id IS NOT NULL) AS "hasScreenshot"
                FROM builds
                JOIN build_artifacts AS dist
                  ON dist.build_id = builds.id AND dist.path = 'dist/index.html' AND dist.kind = 'dist'
                LEFT JOIN build_artifacts AS screenshot
                  ON screenshot.build_id = builds.id AND screenshot.path = 'screenshots/desktop.png'
                  AND screenshot.kind = 'screenshot'
                WHERE builds.prototype_id = prototypes.id AND builds.state = 'successful'
                ORDER BY (screenshot.id IS NOT NULL) DESC,
                  COALESCE(builds.workflow_created_at, builds.created_at) DESC, builds.number DESC
                LIMIT 1
              ) AS review_build ON TRUE
              WHERE prototypes.id IN (${Prisma.join(
                records.map(({ id }) => Prisma.sql`${id}::uuid`),
              )})
            `)
          : []
      // Name the selected user even when no card on this page belongs to them.
      const selectedAuthor = filters.authorId
        ? await transaction.user.findFirst({
            where: { id: filters.authorId, prototypes: { some: eligible } },
            select: authorSelect,
          })
        : null
      return { records, totalCount, page, selectedAuthor, latestBuilds, reviewBuilds }
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
  const previews = new Map(reviewBuilds.map(({ prototypeId, ...build }) => [prototypeId, build]))
  const prototypes = records.map((record) => {
    if (!record.name) throw new Error("A registered prototype must have a name.")
    addAuthor(record.author)
    const latestBuild = latestBuilds.get(record.id)
    const preview = previews.get(record.id)
    return {
      id: record.id,
      repositoryId: record.repositoryId,
      name: record.name,
      description: record.description,
      branchName: record.branchName,
      authorId: record.author?.id ?? null,
      authorLogin: record.author
        ? (record.author.profile?.login ?? null)
        : latestBuild?.authorProvider === "github"
          ? latestBuild.authorLogin
          : null,
      canEdit: false,
      latestBuild: latestBuild ? { number: latestBuild.number, state: latestBuild.state } : null,
      reviewBuild: preview
        ? {
            number: preview.number,
            desktopScreenshotUrl:
              preview.hasScreenshot && buildArtifactUrl
                ? buildArtifactUrl(
                    preview.id,
                    record.repositoryId,
                    record.id,
                    preview.number,
                    "desktop",
                  )
                : null,
          }
        : null,
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

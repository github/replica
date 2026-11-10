import type { Prisma } from "../../../generated/prisma/client.ts"

const pageSize = 24

export async function findRepositoryIndex(
  database: Pick<Prisma.TransactionClient, "prototype" | "repository">,
  repositoryId: string,
) {
  const repository = await database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: { id: true, nameWithOwner: true, defaultBranch: true },
  })
  if (!repository) return null

  const where: Prisma.PrototypeWhereInput = {
    repositoryId,
    registeredAt: { not: null },
    branchDeletedAt: null,
    replica: false,
    branchName: { notIn: [repository.defaultBranch, "replica/install-workflow"] },
  }
  const [records, totalCount] = await Promise.all([
    database.prototype.findMany({
      where,
      orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
      take: pageSize,
      select: {
        id: true,
        repositoryId: true,
        name: true,
        description: true,
        branchName: true,
        author: {
          select: { id: true, profile: { select: { login: true, name: true, provider: true } } },
        },
      },
    }),
    database.prototype.count({ where }),
  ])
  const authors = new Map<
    string,
    { id: string; login: string; name: string | null; provider: string; avatarUrl: null }
  >()
  const prototypes = records.map((record) => {
    if (!record.name) throw new Error("A registered prototype must have a name.")
    if (record.author?.profile) {
      authors.set(record.author.id, {
        id: record.author.id,
        login: record.author.profile.login,
        name: record.author.profile.name,
        provider: record.author.profile.provider,
        avatarUrl: null,
      })
    }
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
      page: 1,
      pageSize,
      totalCount,
      pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    },
  }
}

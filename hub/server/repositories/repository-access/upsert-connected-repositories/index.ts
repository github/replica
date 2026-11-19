import type { Prisma } from "../../../generated/prisma/client.ts"
import type { ConnectedRepositoryEvidence } from "../types.ts"

interface StoredRepository {
  defaultBranch: string
  githubRepositoryId: bigint | null
  id: string
  nameWithOwner: string
  removedAt: Date | null
}

interface PlannedRepository {
  data: { defaultBranch: string; githubRepositoryId: bigint; nameWithOwner: string }
  existing?: StoredRepository
}

const storedFields = {
  defaultBranch: true,
  githubRepositoryId: true,
  id: true,
  nameWithOwner: true,
  removedAt: true,
} as const

/**
 * Records repositories the GitHub App can read, matching only immutable GitHub IDs.
 * Returns Hub IDs in order using bounded queries for the supported installation size.
 */
export async function upsertConnectedRepositories(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "repository">,
  repositories: ConnectedRepositoryEvidence[],
  options: { allowReconnect: boolean },
): Promise<string[]> {
  if (!repositories.length) return []
  const byGitHubId = new Map<bigint, StoredRepository>()
  const stored = await database.repository.findMany({
    select: storedFields,
    where: {
      githubRepositoryId: { in: [...new Set(repositories.map(githubIdOf))] },
    },
  })
  for (const row of stored)
    if (row.githubRepositoryId !== null) byGitHubId.set(row.githubRepositoryId, row)
  const planned = new Map<bigint, PlannedRepository>()
  for (const repository of repositories) {
    const githubRepositoryId = githubIdOf(repository)
    const data = {
      defaultBranch: repository.defaultBranch,
      githubRepositoryId,
      nameWithOwner: repository.nameWithOwner,
    }
    const previous = planned.get(githubRepositoryId)
    if (previous) {
      previous.data = data
      continue
    }
    const existing = byGitHubId.get(githubRepositoryId)
    if (existing?.removedAt && !options.allowReconnect) {
      throw new Error("User evidence cannot reconnect a disconnected GitHub repository.")
    }
    planned.set(githubRepositoryId, { data, existing })
  }

  const plans = [...planned.values()]
  const createdIds = await createRepositories(
    database,
    plans.filter((plan) => !plan.existing).map((plan) => plan.data),
  )
  await updateRepositories(
    database,
    plans.flatMap(({ data, existing }) =>
      existing && hasChanged(existing, data) ? [{ ...data, id: existing.id }] : [],
    ),
  )
  await retainRenamedDefaultBranches(database, plans)
  return repositories.map((repository) => {
    const githubRepositoryId = githubIdOf(repository)
    const id = planned.get(githubRepositoryId)?.existing?.id ?? createdIds.get(githubRepositoryId)
    if (!id) throw new Error("A connected repository was not saved.")
    return id
  })
}

async function retainRenamedDefaultBranches(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  plans: PlannedRepository[],
) {
  const branches = plans.flatMap(({ existing, data }) =>
    existing && existing.defaultBranch !== data.defaultBranch
      ? [...new Set([existing.defaultBranch, data.defaultBranch])]
          .filter((name) => name !== "replica/install-workflow")
          .map((name) => ({ repositoryId: existing.id, name }))
      : [],
  )
  if (!branches.length) return
  // Both names remain internal even if the rename is observed before the first Build scan.
  await database.$executeRaw`
    INSERT INTO "prototypes" ("id", "repository_id", "branch_name", "replica")
    SELECT gen_random_uuid(), branch.repository_id::uuid, branch.name, TRUE
    FROM unnest(
      ${branches.map(({ repositoryId }) => repositoryId)}::text[],
      ${branches.map(({ name }) => name)}::text[]
    ) AS branch(repository_id, name)
    ON CONFLICT ("repository_id", "branch_name") WHERE "branch_deleted_at" IS NULL
    DO UPDATE SET "replica" = TRUE, "registered_at" = NULL, "updated_at" = clock_timestamp()
    WHERE NOT "prototypes"."replica"
  `
}

function githubIdOf(repository: ConnectedRepositoryEvidence): bigint {
  return BigInt(repository.githubRepositoryId)
}

function hasChanged(existing: StoredRepository, data: PlannedRepository["data"]): boolean {
  return (
    existing.removedAt !== null ||
    existing.githubRepositoryId !== data.githubRepositoryId ||
    existing.nameWithOwner !== data.nameWithOwner ||
    existing.defaultBranch !== data.defaultBranch
  )
}

async function createRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
  data: PlannedRepository["data"][],
): Promise<Map<bigint, string>> {
  if (!data.length) return new Map()
  const created = await database.repository.createManyAndReturn({
    data,
    select: { githubRepositoryId: true, id: true },
  })
  return new Map(created.map((row) => [row.githubRepositoryId as bigint, row.id]))
}

/** Prisma cannot apply different values to many rows in one statement. */
async function updateRepositories(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  changes: Array<PlannedRepository["data"] & { id: string }>,
): Promise<void> {
  if (!changes.length) return
  await database.$executeRaw`
    UPDATE "repositories" AS repository
    SET
      "name_with_owner" = change.name_with_owner,
      "default_branch" = change.default_branch,
      "github_repository_id" = change.github_repository_id::bigint,
      "removed_at" = NULL,
      "updated_at" = clock_timestamp()
    FROM unnest(
      ${changes.map((change) => change.id)}::uuid[],
      ${changes.map((change) => change.nameWithOwner)}::text[],
      ${changes.map((change) => change.defaultBranch)}::text[],
      ${changes.map((change) => change.githubRepositoryId.toString())}::text[]
    ) AS change(id, name_with_owner, default_branch, github_repository_id)
    WHERE repository."id" = change.id
  `
}

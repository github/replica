import type { Prisma } from "../../../generated/prisma/client.ts"

export interface HostedRepositorySnapshot {
  id: string
  githubId: bigint
  nameWithOwner: string
  defaultBranch: string
  accessRevision: number
  branchScan?: number
}

export async function lockHostedBuildRepository(
  transaction: Prisma.TransactionClient,
  snapshot: HostedRepositorySnapshot,
) {
  const rows = await transaction.$queryRaw<Array<{ hosted_branch_scan: number }>>`
    SELECT "hosted_branch_scan" FROM "repositories"
    WHERE "id" = ${snapshot.id}::uuid AND "github_repository_id" = ${snapshot.githubId}
      AND "name_with_owner" = ${snapshot.nameWithOwner} AND "default_branch" = ${snapshot.defaultBranch}
      AND "removed_at" IS NULL AND "local_path" IS NULL
    FOR UPDATE
  `
  return (
    rows.length === 1 &&
    (snapshot.branchScan === undefined || rows[0]?.hosted_branch_scan === snapshot.branchScan)
  )
}

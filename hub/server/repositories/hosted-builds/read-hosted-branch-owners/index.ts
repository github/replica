import type { PrismaClient } from "../../../generated/prisma/client.ts"

export interface HostedBranchOwner {
  id: string
  head: string | null
  currentBuildId: string | null
  deleted: boolean
  internal: boolean
}

/** Snapshot the active owner or the latest retired owner of each branch for ref/ancestry checks. */
export async function readHostedBranchOwners(database: PrismaClient, repositoryId: string) {
  const owners = await database.$queryRaw<Array<HostedBranchOwner & { branchName: string }>>`
    SELECT DISTINCT ON (prototype."branch_name") prototype."id", prototype."branch_name" AS "branchName",
      prototype."current_build_id" AS "currentBuildId", prototype."replica" AS "internal",
      prototype."branch_deleted_at" IS NOT NULL AS "deleted", build."commit_sha" AS "head"
    FROM "prototypes" prototype
    LEFT JOIN "builds" build ON build."id" = prototype."current_build_id"
    WHERE prototype."repository_id" = ${repositoryId}::uuid
    ORDER BY prototype."branch_name", prototype."branch_deleted_at" DESC NULLS FIRST, prototype."id" DESC
  `
  return new Map(owners.map(({ branchName, ...owner }) => [branchName, owner]))
}

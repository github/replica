import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockActiveMembershipAssignments(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  const bootstrap = await database.$queryRaw<
    Array<{
      id: string
      role: "MEMBER" | "ADMINISTRATOR"
      source: "BOOTSTRAP" | "HUB_ADMINISTRATOR"
    }>
  >`
    SELECT "id", "role"::text, "source"::text
    FROM "membership_assignments"
    WHERE "membership_id" = ${membershipId}::uuid
      AND "lifecycle" = 'ACTIVE'
      AND "source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
      AND "role" = 'ADMINISTRATOR'
    ORDER BY "id"
    FOR UPDATE
  `
  const provider = await database.$queryRaw<
    Array<{
      id: string
      role: "MEMBER" | "ADMINISTRATOR"
      source: "BOOTSTRAP" | "AUTHENTICATION_PROVIDER"
    }>
  >`
    SELECT assignment."id", assignment."role"::text, assignment."source"::text
    FROM "membership_assignments" assignment
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = assignment."provider_revision_id"
    JOIN "authentication_providers" provider
      ON provider."id" = revision."provider_id"
    WHERE assignment."membership_id" = ${membershipId}::uuid
      AND assignment."lifecycle" = 'ACTIVE'
      AND assignment."source" = 'AUTHENTICATION_PROVIDER'
      AND provider."enabled" = true
      AND provider."selected_revision_id" = assignment."provider_revision_id"
    ORDER BY assignment."id"
    FOR UPDATE OF assignment
  `
  return [...bootstrap, ...provider].sort((left, right) => left.id.localeCompare(right.id))
}

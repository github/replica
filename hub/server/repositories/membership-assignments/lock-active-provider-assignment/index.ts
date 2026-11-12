import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockActiveProviderAssignment(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  externalIdentityId: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      id: string
      providerAssignmentSubject: string
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR"
    }>
  >`
    SELECT
      "id",
      "provider_assignment_subject" AS "providerAssignmentSubject",
      "provider_revision_id" AS "providerRevisionId",
      "role"::text
    FROM "membership_assignments"
    WHERE "external_identity_id" = ${externalIdentityId}::uuid
      AND "source" = 'AUTHENTICATION_PROVIDER'
      AND "lifecycle" = 'ACTIVE'
    FOR UPDATE
  `
  return rows[0] ?? null
}

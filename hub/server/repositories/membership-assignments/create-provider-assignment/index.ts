import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    externalIdentityId: z.uuid(),
    id: z.uuid(),
    membershipId: z.uuid(),
    providerAssignmentSubject: z.uuid(),
    providerRevisionId: z.uuid(),
    role: z.enum(["MEMBER", "ADMINISTRATOR"]),
  })
  .strict()

export async function createProviderAssignment(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: z.input<typeof inputSchema>,
) {
  const parsed = inputSchema.parse(input)
  const created = await database.$executeRaw`
    INSERT INTO "membership_assignments" (
      "id",
      "membership_id",
      "external_identity_id",
      "provider_revision_id",
      "source",
      "role",
      "lifecycle",
      "provider_assignment_subject",
      "created_at",
      "updated_at"
    ) VALUES (
      ${parsed.id}::uuid,
      ${parsed.membershipId}::uuid,
      ${parsed.externalIdentityId}::uuid,
      ${parsed.providerRevisionId}::uuid,
      'AUTHENTICATION_PROVIDER',
      ${parsed.role}::"MembershipRole",
      'ACTIVE',
      ${parsed.providerAssignmentSubject.toLowerCase()},
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT DO NOTHING
  `
  return created === 1
}

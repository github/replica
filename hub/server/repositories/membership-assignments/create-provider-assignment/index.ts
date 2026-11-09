import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    externalIdentityId: z.uuid(),
    id: z.uuid(),
    membershipId: z.uuid(),
    providerAssignmentSubject: z.string().min(1).max(100),
    providerRevisionId: z.uuid(),
    role: z.enum(["MEMBER", "ADMINISTRATOR"]),
  })
  .strict()

export async function createProviderAssignment(
  database: Pick<Prisma.TransactionClient, "membershipAssignment">,
  input: z.input<typeof inputSchema>,
) {
  const parsed = inputSchema.parse(input)
  const result = await database.membershipAssignment.createMany({
    data: {
      id: parsed.id,
      membershipId: parsed.membershipId,
      externalIdentityId: parsed.externalIdentityId,
      providerRevisionId: parsed.providerRevisionId,
      source: "AUTHENTICATION_PROVIDER",
      role: parsed.role,
      providerAssignmentSubject: parsed.providerAssignmentSubject,
    },
    skipDuplicates: true,
  })
  return result.count === 1
}

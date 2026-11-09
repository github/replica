import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    externalIdentityId: z.uuid(),
    id: z.uuid(),
    membershipId: z.uuid(),
  })
  .strict()

export async function createAdministratorAssignment(
  database: Pick<Prisma.TransactionClient, "membershipAssignment">,
  input: z.input<typeof inputSchema>,
) {
  const parsed = inputSchema.parse(input)
  return database.membershipAssignment.create({
    data: {
      id: parsed.id,
      membershipId: parsed.membershipId,
      externalIdentityId: parsed.externalIdentityId,
      source: "HUB_ADMINISTRATOR",
      role: "ADMINISTRATOR",
    },
  })
}

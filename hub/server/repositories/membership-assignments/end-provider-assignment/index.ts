import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    id: z.uuid(),
    lifecycle: z.enum(["SUPERSEDED", "REVOKED"]),
  })
  .strict()

export async function endProviderAssignment(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: z.input<typeof inputSchema>,
) {
  const parsed = inputSchema.parse(input)
  const changed = await database.$executeRaw`
    UPDATE "membership_assignments"
    SET
      "lifecycle" = ${parsed.lifecycle}::"MembershipAssignmentLifecycle",
      "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 millisecond')
    WHERE "id" = ${parsed.id}::uuid
      AND "source" = 'AUTHENTICATION_PROVIDER'
      AND "lifecycle" = 'ACTIVE'
  `
  if (changed !== 1) {
    throw new Error("The active provider assignment changed before it could be ended.")
  }
}

import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z.object({ id: z.uuid(), userId: z.uuid() }).strict()

export async function createMembership(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: { id: string; userId: string },
) {
  const parsed = inputSchema.parse(input)
  const created = await database.$executeRaw`
    INSERT INTO "memberships" (
      "id", "user_id", "lifecycle", "created_at", "updated_at"
    ) VALUES (
      ${parsed.id}::uuid,
      ${parsed.userId}::uuid,
      'ACTIVE',
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT ("user_id") DO NOTHING
  `
  return created === 1
}

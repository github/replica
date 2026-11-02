import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSessionRevocationState(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
) {
  await database.$executeRaw`
    INSERT INTO "session_revocation_states" (
      "id", "key", "revision", "created_at", "updated_at"
    ) VALUES (
      gen_random_uuid(), 'global', 0, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("key") DO NOTHING
  `
  const rows = await database.$queryRaw<Array<{ revision: number }>>`
    SELECT "revision"
    FROM "session_revocation_states"
    WHERE "key" = 'global'
    FOR UPDATE
  `
  return rows[0] ?? null
}

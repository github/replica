import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    id: z.uuid(),
    login: z.string().min(1).max(200),
    name: z.string().min(1).max(200).nullable(),
    provider: z.string().min(1).max(100),
  })
  .strict()

export async function upsertUserProfile(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: z.input<typeof inputSchema>,
): Promise<void> {
  const parsed = inputSchema.parse(input)
  await database.$executeRaw`
    INSERT INTO "user_profiles" (
      "id", "user_id", "provider", "login", "name", "created_at", "updated_at"
    )
    SELECT
      gen_random_uuid(),
      identity."user_id",
      ${parsed.provider},
      ${parsed.login},
      ${parsed.name},
      clock_timestamp(),
      clock_timestamp()
    FROM "external_identities" identity
    WHERE identity."id" = ${parsed.id}::uuid
    ON CONFLICT ("user_id") DO UPDATE SET
      "provider" = EXCLUDED."provider",
      "login" = EXCLUDED."login",
      "name" = EXCLUDED."name",
      "updated_at" = clock_timestamp()
  `
}

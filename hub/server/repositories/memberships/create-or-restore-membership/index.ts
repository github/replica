import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createOrRestoreMembership(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  input: { id: string; userId: string },
): Promise<{ id: string; transition: "created" | "restored" | "unchanged" }> {
  const existing = await database.$queryRaw<
    Array<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" }>
  >`
    SELECT "id", "lifecycle"::text
    FROM "memberships"
    WHERE "user_id" = ${input.userId}::uuid
    FOR UPDATE
  `
  const membership = existing[0]
  if (!membership) {
    await database.$executeRaw`
      INSERT INTO "memberships" (
        "id", "user_id", "lifecycle", "created_at", "updated_at"
      ) VALUES (
        ${input.id}::uuid, ${input.userId}::uuid, 'ACTIVE',
        clock_timestamp(), clock_timestamp()
      )
    `
    return { id: input.id, transition: "created" }
  }
  if (membership.lifecycle === "ACTIVE") {
    return { id: membership.id, transition: "unchanged" }
  }
  await database.$executeRaw`
    UPDATE "memberships"
    SET "lifecycle" = 'ACTIVE', "updated_at" = clock_timestamp()
    WHERE "id" = ${membership.id}::uuid
      AND "lifecycle" <> 'ACTIVE'
  `
  return { id: membership.id, transition: "restored" }
}

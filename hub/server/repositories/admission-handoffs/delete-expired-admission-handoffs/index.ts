import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteExpiredAdmissionHandoffs(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
): Promise<void> {
  await database.$executeRaw`
    DELETE FROM "admission_handoffs"
    WHERE "expires_at" <= clock_timestamp()
  `
}

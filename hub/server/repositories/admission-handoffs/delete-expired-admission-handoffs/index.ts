import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteExpiredAdmissionHandoffs(
  database: Pick<Prisma.TransactionClient, "admissionHandoff">,
  now: Date,
): Promise<void> {
  await database.admissionHandoff.deleteMany({ where: { expiresAt: { lte: now } } })
}

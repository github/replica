import type { Prisma } from "../../../generated/prisma/client.ts"

export async function consumeAdmissionHandoff(
  database: Pick<Prisma.TransactionClient, "admissionHandoff">,
  input: { id: string; consumedAt: Date },
): Promise<boolean> {
  const consumed = await database.admissionHandoff.updateMany({
    where: { id: input.id, consumedAt: null },
    data: { consumedAt: input.consumedAt },
  })
  return consumed.count === 1
}

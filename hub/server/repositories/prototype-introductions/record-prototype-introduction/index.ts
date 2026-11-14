import type { Prisma } from "../../../generated/prisma/client.ts"

export async function recordPrototypeIntroduction(
  database: Pick<Prisma.TransactionClient, "prototypeIntroduction">,
  userId: string,
  prototypeId: string,
) {
  const result = await database.prototypeIntroduction.createMany({
    data: { userId, prototypeId },
    skipDuplicates: true,
  })
  return result.count === 1
}

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function revokeShareLink(
  database: Prisma.TransactionClient,
  input: { prototypeId: string; publicId: string; revokedAt: Date },
) {
  const result = await database.shareLink.updateMany({
    where: { prototypeId: input.prototypeId, publicId: input.publicId, revokedAt: null },
    data: { revokedAt: input.revokedAt },
  })
  return result.count === 1
}

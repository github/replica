import type { Prisma } from "../../../generated/prisma/client.ts"

export function updateSharingSetting(
  database: Prisma.TransactionClient,
  input: { id: string; enabled: boolean },
) {
  return database.sharingSetting.update({
    where: { id: input.id },
    data: {
      publicSharingEnabled: input.enabled,
      revision: { increment: 1 },
    },
  })
}

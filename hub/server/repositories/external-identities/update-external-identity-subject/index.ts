import type { Prisma } from "../../../generated/prisma/client.ts"

export function updateExternalIdentitySubject(
  database: Prisma.TransactionClient,
  id: string,
  subject: string,
) {
  return database.externalIdentity.update({
    where: { id },
    data: { subject },
    include: { user: true },
  })
}

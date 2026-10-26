import type { Prisma } from "../../../generated/prisma/client.ts"

export async function verifySession(
  database: Prisma.TransactionClient,
  id: string,
  freshAuthorizedAt: Date,
  credentialRevision: string,
) {
  await database.session.update({
    where: { id },
    data: { freshAuthorizedAt, credentialRevision },
  })
}

import type { Prisma } from "../../../generated/prisma/client.ts"

export function getExternalIdentity(
  database: Prisma.TransactionClient,
  provider: string,
  issuer: string,
  subject: string,
) {
  return database.externalIdentity.findUnique({
    where: { provider_issuer_subject: { provider, issuer, subject } },
    include: { user: true },
  })
}

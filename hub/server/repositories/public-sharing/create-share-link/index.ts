import type { Prisma } from "../../../generated/prisma/client.ts"

export function createShareLink(
  database: Prisma.TransactionClient,
  input: {
    buildId: string
    createdAt: Date
    createdByExternalIdentityId?: string
    createdById: string
    createdByLogin: string
    expiresAt: Date
    label: string
    prototypeId: string
    publicId: string
  },
) {
  return database.shareLink.create({ data: input })
}

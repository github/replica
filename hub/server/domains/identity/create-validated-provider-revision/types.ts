import type { Prisma } from "../../../generated/prisma/client.ts"

export interface CreateValidatedProviderRevisionInput {
  providerKey: string
  revision: number
  settings: Prisma.InputJsonObject
}

export interface ValidatedProviderRevision extends CreateValidatedProviderRevisionInput {
  configurationDigest: string
}

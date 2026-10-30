import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAuthenticationProviderRevisionDatabase = Pick<
  Prisma.TransactionClient,
  "authenticationProviderRevision"
>

export interface CreateAuthenticationProviderRevisionInput {
  id: string
  providerId: string
  revision: number
  configurationDigest: string
}

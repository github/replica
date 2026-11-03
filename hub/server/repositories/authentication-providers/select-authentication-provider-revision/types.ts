import type { Prisma } from "../../../generated/prisma/client.ts"

export type SelectAuthenticationProviderRevisionDatabase = Pick<
  Prisma.TransactionClient,
  "authenticationProvider"
>

export interface SelectAuthenticationProviderRevisionInput {
  providerId: string
  revisionId: string
}

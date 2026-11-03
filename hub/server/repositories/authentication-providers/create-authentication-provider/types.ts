import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAuthenticationProviderDatabase = Pick<
  Prisma.TransactionClient,
  "authenticationProvider"
>

export interface CreateAuthenticationProviderInput {
  id: string
  key: string
}

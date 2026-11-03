import type { Prisma } from "../../../generated/prisma/client.ts"

export type FindAuthenticationProviderDatabase = Pick<
  Prisma.TransactionClient,
  "authenticationProvider"
>

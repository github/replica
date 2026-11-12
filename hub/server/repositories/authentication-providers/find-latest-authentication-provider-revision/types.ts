import type { Prisma } from "../../../generated/prisma/client.ts"

export type FindLatestAuthenticationProviderRevisionDatabase = Pick<
  Prisma.TransactionClient,
  "authenticationProvider"
>

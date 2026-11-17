import { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Installation-wide GitHub access changes revoke every affected membership in one transaction so
 * access never ends half-revoked. Prisma's five-second default can roll that back for a large
 * installation, so allow a minute; the database test covers 1,000 revoked memberships.
 */
export const githubAccessTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 60_000,
} as const

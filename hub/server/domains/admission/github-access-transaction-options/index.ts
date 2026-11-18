import { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Installation-wide GitHub access changes revoke every affected membership in one transaction so
 * access never ends half-revoked. Revocation uses set-based statements, but grant reconciliation
 * and audit volume still grow with the installation, so allow more than Prisma's five-second
 * default. The database tests cover 1,000 revoked memberships.
 */
export const githubAccessTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 60_000,
} as const

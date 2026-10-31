import type { Prisma } from "../../../generated/prisma/client.ts"

export interface ReserveAuthenticationRateLimitInput {
  id: string
  keyDigest: string
  limit: number
  scope: "github_callback" | "github_start"
  windowSeconds: number
}

export type AuthenticationRateLimitDatabase = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "$queryRaw"
>

export interface AuthenticationRateLimitReservation {
  reserved: boolean
  shouldAuditDenial: boolean
}

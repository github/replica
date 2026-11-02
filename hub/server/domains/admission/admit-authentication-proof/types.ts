import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import type { AuthenticationProofResult } from "../../authentication/types.ts"

export interface AdmitAuthenticationProofInput {
  proof: AuthenticationProofResult
  providerKey: string
  sessionDigest: string
  sessionId: string
  sessionLifetimeSeconds: number
}

export interface AdmitAuthenticationProofDependencies {
  createId(): string
  database: Pick<PrismaClient, "$transaction" | "securityAudit">
}

export interface AdmittedHubSession {
  expiresAt: Date
  membershipId: string
  role: "administrator" | "member"
  sessionId: string
  userId: string
}

export type AdmissionTransaction = Prisma.TransactionClient

import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

export interface AdmissionRepositories {
  createBootstrapAssignment(input: {
    externalIdentityId: string
    id: string
    membershipId: string
  }): Promise<"created" | "restored" | "unchanged" | null>
  createHubSession(input: {
    digest: string
    id: string
    lifetimeSeconds: number
    membershipId: string
    revocationRevision: number
    userId: string
  }): Promise<{ expiresAt: Date }>
  createOrRestoreMembership(input: { id: string; userId: string }): Promise<{ id: string }>
  createSecurityAudit(input: CreateSecurityAuditEvent): Promise<unknown>
  lockActiveAssignment(membershipId: string): Promise<{ role: "ADMINISTRATOR" } | null>
  lockAttempt(id: string): Promise<{
    consumedAt: Date | null
    providerRevisionId: string
    purpose: "SIGN_IN" | "ADMIN_ENROLLMENT"
  } | null>
  lockExternalIdentity(id: string): Promise<{ provider: string; userId: string } | null>
  lockMembership(
    userId: string,
  ): Promise<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" } | null>
  lockProvider(key: string): Promise<{ selectedRevisionId: string | null } | null>
  lockRevocation(): Promise<{ revision: number } | null>
  lockUser(id: string): Promise<{ id: string } | null>
}

export type AdmissionTransaction = <Result>(
  operation: (repositories: AdmissionRepositories) => Promise<Result>,
) => Promise<Result>

export interface AdmissionDatabaseClient {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

export interface AdmissionRepositories {
  claimProviderEvidence(input: {
    externalIdentityId: string
    id: string
    issuedAt: Date
    role: "MEMBER" | "ADMINISTRATOR" | null
  }): Promise<"advanced" | "conflict" | "created" | "stale">
  createMembership(input: { id: string; userId: string }): Promise<boolean>
  createProviderAssignment(input: {
    externalIdentityId: string
    id: string
    membershipId: string
    providerAssignmentSubject: string
    providerRevisionId: string
    role: "MEMBER" | "ADMINISTRATOR"
  }): Promise<boolean>
  createBootstrapAssignment(input: {
    externalIdentityId: string
    id: string
    membershipId: string
  }): Promise<"created" | "restored" | "unchanged" | null>
  createHubSession(input: {
    digest: string
    externalIdentityId: string
    id: string
    lifetimeSeconds: number
    membershipId: string
    providerRevisionId: string
    revocationRevision: number
  }): Promise<{ expiresAt: Date }>
  createOrRestoreMembership(input: { id: string; userId: string }): Promise<{
    id: string
    transition: "created" | "restored" | "unchanged"
  }>
  createSecurityAudit(input: CreateSecurityAuditEvent): Promise<unknown>
  disconnectCopilotConnection?(membershipId: string): Promise<boolean>
  endProviderAssignment(input: { id: string; lifecycle: "SUPERSEDED" | "REVOKED" }): Promise<void>
  endOpenHubSessionsForMembership(membershipId: string): Promise<Array<{ id: string }>>
  lockActiveAssignments(membershipId: string): Promise<
    Array<{
      id: string
      role: "MEMBER" | "ADMINISTRATOR"
      source: "BOOTSTRAP" | "AUTHENTICATION_PROVIDER" | "HUB_ADMINISTRATOR"
    }>
  >
  lockActiveProviderAssignment(externalIdentityId: string): Promise<{
    id: string
    providerAssignmentSubject: string
    providerRevisionId: string
    role: "MEMBER" | "ADMINISTRATOR"
  } | null>
  lockAttempt(id: string): Promise<{
    bootstrapSecretDigest: string | null
    consumedAt: Date | null
    providerRevisionId: string
    purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
    sessionRevocationRevision: number
  } | null>
  getExternalIdentity(id: string): Promise<{ provider: string; userId: string } | null>
  lockMembership(
    userId: string,
  ): Promise<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" } | null>
  lockProvider(key: string): Promise<{ enabled: boolean; selectedRevisionId: string | null } | null>
  lockRevocation(): Promise<{ revision: number } | null>
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

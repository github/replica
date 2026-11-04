import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

export interface AdmissionRepositories {
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
    id: string
    lifetimeSeconds: number
    membershipId: string
    revocationRevision: number
  }): Promise<{ expiresAt: Date }>
  createOrRestoreMembership(input: { id: string; userId: string }): Promise<{
    id: string
    transition: "created" | "restored" | "unchanged"
  }>
  createSecurityAudit(input: CreateSecurityAuditEvent): Promise<unknown>
  endProviderAssignment(input: { id: string; lifecycle: "SUPERSEDED" | "REVOKED" }): Promise<void>
  endOpenHubSessionsForMembership(membershipId: string): Promise<Array<{ id: string }>>
  lockActiveAssignments(membershipId: string): Promise<
    Array<{
      id: string
      role: "MEMBER" | "ADMINISTRATOR"
      source: "BOOTSTRAP" | "AUTHENTICATION_PROVIDER"
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
    purpose: "SIGN_IN" | "ADMIN_ENROLLMENT"
  } | null>
  getExternalIdentity(id: string): Promise<{ provider: string; userId: string } | null>
  lockMembership(
    userId: string,
  ): Promise<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" } | null>
  lockProvider(key: string): Promise<{ selectedRevisionId: string | null } | null>
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

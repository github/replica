import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { AuthenticationProofResult } from "../../authentication/types.ts"
import type { AdmissionTransaction } from "../run-admission-transaction/types.ts"

export interface AdmitAuthenticationProofInput {
  proof: AuthenticationProofResult
  providerAssignment?: {
    assignmentSubject: string | null
    issuedAt: Date
    providerRevisionId: string
    role: "MEMBER" | "ADMINISTRATOR" | null
  }
  providerKey: string
  /** Current GitHub repository access evidence; omitted for other providers. */
  repositoryAccess?: Array<{
    accessLevel: "READ" | "TRIAGE" | "WRITE" | "MAINTAIN" | "ADMIN"
    defaultBranch: string
    githubRepositoryId: number
    nameWithOwner: string
  }>
  requiresProviderAssignmentEvidence: boolean
  sessionDigest: string
  sessionId: string
  sessionLifetimeSeconds: number
}

export interface AdmitAuthenticationProofDependencies {
  createId(): string
  getBootstrapSecretDigest(): string
  runTransaction: AdmissionTransaction
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

export interface AdmittedHubSession {
  expiresAt: Date
  role: "MEMBER" | "ADMINISTRATOR"
}

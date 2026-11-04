import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { AuthenticationProofResult } from "../../authentication/types.ts"
import type { AdmissionTransaction } from "../run-admission-transaction/types.ts"

export interface AdmitAuthenticationProofInput {
  proof: AuthenticationProofResult
  providerKey: string
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
}

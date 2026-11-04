import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { AuthenticationProviderReconciliationTransaction } from "../run-provider-revision-transaction/types.ts"

export interface ReconcileAuthenticationProviderCandidate {
  canonicalPublicConfiguration: string
  providerKey: string
  revision: number
}

export interface ReconcileAuthenticationProvidersDependencies {
  createId(): string
  runTransaction: AuthenticationProviderReconciliationTransaction
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

export interface ReconciledAuthenticationProvider {
  providerId: string
  providerKey: string
  revision: number
  revisionId: string
}

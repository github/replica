import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { ProviderRevisionTransaction } from "../run-provider-revision-transaction/types.ts"
import type { TransactionRetryOptions } from "../run-with-bounded-retries/types.ts"

export interface ValidatedProviderConfiguration {
  canonicalPublicConfiguration: string
}

export interface ValidateAndPersistProviderRevisionDependencies<Candidate> {
  createId(): string
  retry: TransactionRetryOptions
  runTransaction: ProviderRevisionTransaction
  validateConfiguration(candidate: Candidate): Promise<ValidatedProviderConfiguration>
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

export interface ValidateAndPersistProviderRevisionInput<Candidate> {
  configuration: Candidate
  providerKey: string
  revision: number
}

export type ValidateAndPersistProviderRevisionResult =
  | { status: "selected"; providerId: string; revisionId: string; revision: number }
  | { status: "unchanged"; providerId: string; revisionId: string; revision: number }

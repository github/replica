import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { IdentityCreationTransaction } from "../run-identity-creation-transaction/types.ts"
import type { TransactionRetryOptions } from "../run-with-bounded-retries/types.ts"

export interface ResolveOrCreateExternalIdentityDependencies {
  createId(): string
  retry: TransactionRetryOptions
  runTransaction: IdentityCreationTransaction
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

export interface ResolveOrCreateExternalIdentityResult {
  externalIdentityId: string
  status: "created" | "found"
  userId: string
}

export type ResolveOrCreateExternalIdentityInput = unknown

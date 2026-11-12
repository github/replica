import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type {
  IdentityCreationRepositories,
  IdentityCreationTransaction,
} from "../run-identity-creation-transaction/types.ts"

export interface ResolveOrCreateExternalIdentityDependencies {
  createId(): string
  isExpectedTransactionDenial?(error: unknown): boolean
  runTransaction: IdentityCreationTransaction
  validateTransaction?(repositories: IdentityCreationRepositories): Promise<void>
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

export interface ResolveOrCreateExternalIdentityResult {
  externalIdentityId: string
  status: "created" | "found"
  userId: string
}

export type ResolveOrCreateExternalIdentityInput = unknown

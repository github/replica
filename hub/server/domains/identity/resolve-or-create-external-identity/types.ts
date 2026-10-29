import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { IdentityCreationTransaction } from "../run-identity-creation-transaction/types.ts"

export interface ResolveOrCreateExternalIdentityDependencies {
  createId(): string
  runTransaction: IdentityCreationTransaction
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

export interface ResolveOrCreateExternalIdentityResult {
  externalIdentityId: string
  status: "created" | "found"
  userId: string
}

export type ResolveOrCreateExternalIdentityInput = unknown

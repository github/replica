import type { CreateSecurityAuditInput } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { ValidatedProviderRevision } from "../create-validated-provider-revision/types.ts"
import type { ProviderRevisionTransaction } from "../run-provider-revision-transaction/types.ts"

export interface PersistValidatedProviderRevisionDependencies {
  createId(): string
  runTransaction: ProviderRevisionTransaction
  writeAudit(input: CreateSecurityAuditInput): Promise<unknown>
}

export type PersistValidatedProviderRevisionResult =
  | { status: "selected"; providerId: string; revisionId: string; revision: number }
  | { status: "unchanged"; providerId: string; revisionId: string; revision: number }

export type PersistValidatedProviderRevisionInput = ValidatedProviderRevision

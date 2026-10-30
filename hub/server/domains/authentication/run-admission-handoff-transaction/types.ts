import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateAdmissionHandoffInput } from "../../../repositories/admission-handoffs/create-admission-handoff/types.ts"
import type { ConsumeAdmissionHandoffResult } from "../../../repositories/admission-handoffs/consume-admission-handoff/types.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { AuthenticationProviderRecord } from "../../identity/run-provider-revision-transaction/types.ts"

export interface AdmissionHandoffRecord {
  browserBindingDigest: string
  consumedAt: Date | null
  displayAttributes: Prisma.JsonValue
  expiresAt: Date
  externalIdentityId: string
  id: string
  providerRevisionId: string
  revocationGeneration: bigint
}

export interface AdmissionHandoffRepositories {
  consumeAdmissionHandoff(input: {
    browserBindingDigest: string
    id: string
  }): Promise<ConsumeAdmissionHandoffResult>
  createAdmissionHandoff(input: CreateAdmissionHandoffInput): Promise<unknown>
  createSecurityAudit(input: CreateSecurityAuditEvent): Promise<unknown>
  findAdmissionHandoff(tokenDigest: string): Promise<AdmissionHandoffRecord | null>
  findAuthenticationProvider(key: string): Promise<AuthenticationProviderRecord | null>
  getAuthenticationRevocationGeneration(): Promise<bigint>
  lockAuthenticationProviderSelection(providerKey: string): Promise<void>
  lockAuthenticationRevocationGeneration(): Promise<void>
}

export type AdmissionHandoffTransaction = <Result>(
  operation: (repositories: AdmissionHandoffRepositories) => Promise<Result>,
) => Promise<Result>

export interface AdmissionHandoffDatabase {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

export interface AdmissionHandoffTransactionFunctions {
  lockProvider(database: Prisma.TransactionClient, providerKey: string): Promise<void>
  lockRevocation(database: Prisma.TransactionClient): Promise<void>
}

import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateAuthenticationProviderRevisionInput } from "../../../repositories/authentication-providers/create-authentication-provider-revision/types.ts"
import type { CreateAuthenticationProviderInput } from "../../../repositories/authentication-providers/create-authentication-provider/types.ts"
import type { FindAuthenticationProviderDatabase } from "../../../repositories/authentication-providers/find-authentication-provider/types.ts"
import type { SelectAuthenticationProviderRevisionInput } from "../../../repositories/authentication-providers/select-authentication-provider-revision/types.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

export interface SelectedProviderRevisionRecord {
  id: string
  providerId: string
  revision: number
  configurationDigest: string
}

export interface AuthenticationProviderRecord {
  id: string
  key: string
  selectedRevision: SelectedProviderRevisionRecord | null
}

export type FindAuthenticationProviderForTransaction = (
  database: FindAuthenticationProviderDatabase,
  key: string,
) => Promise<AuthenticationProviderRecord | null>

export interface ProviderRevisionRepositories {
  createAuthenticationProvider(input: CreateAuthenticationProviderInput): Promise<unknown>
  createAuthenticationProviderRevision(
    input: CreateAuthenticationProviderRevisionInput,
  ): Promise<SelectedProviderRevisionRecord>
  createSecurityAudit(input: CreateSecurityAuditEvent): Promise<unknown>
  findAuthenticationProvider(key: string): Promise<AuthenticationProviderRecord | null>
  selectAuthenticationProviderRevision(
    input: SelectAuthenticationProviderRevisionInput,
  ): Promise<unknown>
}

export type ProviderRevisionTransaction = <Result>(
  operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
) => Promise<Result>

export interface ProviderRevisionDatabaseClient {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

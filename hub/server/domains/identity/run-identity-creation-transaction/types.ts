import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { CreateExternalIdentityInput } from "../../../repositories/external-identities/create-external-identity/types.ts"
import type { ExternalIdentityTuple } from "../../../repositories/external-identities/find-external-identity/types.ts"
import type { CreateSecurityAuditInput } from "../../../repositories/security-audits/create-security-audit/types.ts"
import type { CreateUserInput } from "../../../repositories/users/create-user/types.ts"

export interface IdentityCreationRepositories {
  createExternalIdentity(input: CreateExternalIdentityInput): Promise<unknown>
  createSecurityAudit(input: CreateSecurityAuditInput): Promise<unknown>
  createUser(input: CreateUserInput): Promise<unknown>
  findExternalIdentity(tuple: ExternalIdentityTuple): Promise<{ id: string; userId: string } | null>
}

export type IdentityCreationTransaction = <Result>(
  operation: (repositories: IdentityCreationRepositories) => Promise<Result>,
) => Promise<Result>

export type IdentityDatabaseClient = Pick<PrismaClient, "$transaction">

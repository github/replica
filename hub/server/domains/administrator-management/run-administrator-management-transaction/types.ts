import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

export interface AdministratorManagementRepositories {
  createAssignment(input: {
    externalIdentityId: string
    id: string
    membershipId: string
  }): Promise<{ id: string }>
  createSecurityAudit(input: CreateSecurityAuditEvent): Promise<unknown>
  lockActiveAssignment(membershipId: string): Promise<{ id: string } | null>
  lockEffectiveAdministrators(): Promise<Array<{ membershipId: string }>>
  lockTargets(membershipIds: string[]): Promise<
    Array<{
      externalIdentityId: string | null
      lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED"
      membershipId: string
    }>
  >
  revokeAssignment(id: string): Promise<void>
}

export type AdministratorManagementTransaction = <Result>(
  operation: (repositories: AdministratorManagementRepositories) => Promise<Result>,
) => Promise<Result>

export interface AdministratorManagementDatabaseClient {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

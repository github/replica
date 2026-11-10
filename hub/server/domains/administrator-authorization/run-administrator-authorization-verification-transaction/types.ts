import type { Prisma } from "../../../generated/prisma/client.ts"
import type { getSensitiveAuthorizationAuditData } from "../../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data/index.ts"
import type { verifySensitiveAuthorization } from "../../../repositories/sensitive-authorizations/verify-sensitive-authorization/index.ts"
import type { AdmissionRepositories } from "../../admission/run-admission-transaction/types.ts"

export interface AdministratorAuthorizationVerificationRepositories extends AdmissionRepositories {
  getSensitiveAuthorizationAuditData(
    id: string,
  ): ReturnType<typeof getSensitiveAuthorizationAuditData>
  verifySensitiveAuthorization(
    input: Parameters<typeof verifySensitiveAuthorization>[1],
  ): ReturnType<typeof verifySensitiveAuthorization>
}

export type AdministratorAuthorizationVerificationTransaction = <Result>(
  operation: (repositories: AdministratorAuthorizationVerificationRepositories) => Promise<Result>,
) => Promise<Result>

export interface AdministratorAuthorizationVerificationDatabase {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

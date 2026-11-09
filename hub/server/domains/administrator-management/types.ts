import type { AdministratorManagementTransaction } from "./run-administrator-management-transaction/types.ts"
import type { CreateSecurityAuditEvent } from "../../repositories/security-audits/create-security-audit/types.ts"

export interface AdministratorManagementDependencies {
  createId(): string
  runTransaction: AdministratorManagementTransaction
  writeAudit(input: CreateSecurityAuditEvent): Promise<unknown>
}

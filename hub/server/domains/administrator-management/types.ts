import type { AdministratorManagementTransaction } from "./run-administrator-management-transaction/types.ts"

export interface AdministratorManagementDependencies {
  createId(): string
  runTransaction: AdministratorManagementTransaction
}

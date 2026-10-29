import type { Prisma } from "../../../generated/prisma/client.ts"
import type { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"

export interface CreateSecurityAuditDatabase {
  securityAudit: {
    create(input: { data: Prisma.SecurityAuditCreateInput }): Promise<unknown>
  }
}

export type SecurityAuditContextValue = boolean | number | string | null
export type SecurityAuditContext = Record<string, SecurityAuditContextValue>

export interface CreateSecurityAuditInput {
  id: string
  action: string
  outcome: SecurityAuditOutcome
  targetType: string
  targetId?: string
  context: SecurityAuditContext
}

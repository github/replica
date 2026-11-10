import type { Prisma } from "../../../generated/prisma/client.ts"
import type { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"

export interface SecurityAuditListCursor {
  createdAt: Date
  id: string
}

export interface SecurityAuditListRecord {
  action: string
  context: Prisma.JsonValue
  createdAt: Date
  id: string
  outcome: SecurityAuditOutcome | null
  targetId: string | null
}

export interface SecurityAuditListResult {
  nextCursor: SecurityAuditListCursor | null
  records: SecurityAuditListRecord[]
}

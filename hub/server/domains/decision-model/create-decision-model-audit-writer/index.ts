import { randomUUID } from "node:crypto"
import type { Prisma } from "../../../generated/prisma/client.ts"

import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import type { DecisionModelAuditWriter } from "../types.ts"

export function createDecisionModelAuditWriter(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
): DecisionModelAuditWriter {
  return {
    write: (input) => createSecurityAudit(database, { id: randomUUID(), ...input }).then(() => {}),
  }
}

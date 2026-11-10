import type { z } from "zod"

import type { securityAuditResponseSchema } from "."

export type SecurityAuditResponse = z.infer<typeof securityAuditResponseSchema>

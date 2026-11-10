import { z } from "zod"

export const securityAuditActorSchema = z
  .object({
    membershipId: z.uuid(),
  })
  .strict()

export const securityAuditContextValueSchema = z.union([
  z.string(),
  z.number().int(),
  z.array(z.string()),
])

export const securityAuditRecordSchema = z
  .object({
    action: z.string().min(1).max(100),
    actor: securityAuditActorSchema.nullable(),
    context: z.record(z.string(), securityAuditContextValueSchema),
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    outcome: z.enum(["success", "denied", "failure"]).nullable(),
  })
  .strict()

export const securityAuditResponseSchema = z
  .object({
    nextCursor: z.string().nullable(),
    records: z.array(securityAuditRecordSchema).max(50),
  })
  .strict()

export type SecurityAuditRecord = z.infer<typeof securityAuditRecordSchema>
export type SecurityAuditResponse = z.infer<typeof securityAuditResponseSchema>

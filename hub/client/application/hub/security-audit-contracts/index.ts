import { z } from "zod"

const contextValueSchema = z.union([
  z.string().max(500),
  z.number().int(),
  z.array(z.string().max(500)).max(50),
])

const securityAuditContextSchema = z
  .record(z.string().min(1).max(100), contextValueSchema)
  .refine((context) => Object.keys(context).length <= 20)
  .superRefine((context, refinement) => {
    for (const [key, value] of Object.entries(context)) {
      if (
        key !== "credentialProvider" &&
        /^(?:access|refresh|id)?token$|secret|password|credential|cookie|authorization|privatekey|clientassertion|apikey/i.test(
          key,
        )
      ) {
        refinement.addIssue({
          code: "custom",
          message: "Security audit context contains a sensitive field.",
          path: [key],
        })
      }
      if (
        key !== "provider" &&
        typeof value === "string" &&
        (/^(?:basic|bearer)\s/i.test(value) ||
          /^(?:github_pat_|gh[pousr]_)/i.test(value) ||
          /^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
          /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
      ) {
        refinement.addIssue({
          code: "custom",
          message: "Security audit context contains a credential-shaped value.",
          path: [key],
        })
      }
    }
  })

export const securityAuditResponseSchema = z
  .object({
    records: z.array(
      z
        .object({
          id: z.uuid(),
          occurredAt: z.iso.datetime({ offset: true }),
          action: z.string().min(1).max(200),
          outcome: z.enum(["success", "denied", "failure"]).nullable(),
          actor: z
            .object({
              membershipId: z.uuid(),
            })
            .strict()
            .nullable(),
          context: securityAuditContextSchema,
        })
        .strict(),
    ),
    nextCursor: z.string().min(1).max(500).nullable(),
  })
  .strict()

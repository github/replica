import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"
import type { SecurityAuditListResult } from "./types.ts"

const inputSchema = z
  .object({
    before: z
      .object({
        createdAt: z.date(),
        id: z.uuid(),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(50).default(50),
  })
  .strict()

export async function listSecurityAudits(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  input: z.input<typeof inputSchema> = {},
): Promise<SecurityAuditListResult> {
  const parsed = inputSchema.parse(input)
  const rows = await database.securityAudit.findMany({
    where: parsed.before
      ? {
          OR: [
            { createdAt: { lt: parsed.before.createdAt } },
            {
              createdAt: parsed.before.createdAt,
              id: { lt: parsed.before.id },
            },
          ],
        }
      : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      action: true,
      context: true,
      createdAt: true,
      id: true,
      outcome: true,
      targetId: true,
    },
    take: parsed.limit + 1,
  })
  const records = rows.slice(0, parsed.limit)
  const last = records.at(-1)
  return {
    records,
    nextCursor:
      rows.length > parsed.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  }
}

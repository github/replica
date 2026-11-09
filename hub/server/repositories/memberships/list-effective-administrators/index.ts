import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    before: z
      .object({
        createdAt: z.date(),
        membershipId: z.uuid(),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(50).default(50),
  })
  .strict()

export async function listEffectiveAdministrators(
  database: Pick<Prisma.TransactionClient, "membership">,
  input: z.input<typeof inputSchema> = {},
) {
  const parsed = inputSchema.parse(input)
  const rows = await database.membership.findMany({
    where: {
      AND: [
        {
          lifecycle: "ACTIVE",
          assignments: {
            some: {
              lifecycle: "ACTIVE",
              role: "ADMINISTRATOR",
              OR: [
                { source: { in: ["BOOTSTRAP", "HUB_ADMINISTRATOR"] } },
                {
                  source: "AUTHENTICATION_PROVIDER",
                  providerRevision: {
                    selectedBy: { is: { enabled: true } },
                  },
                },
              ],
            },
          },
        },
        parsed.before
          ? {
              OR: [
                { createdAt: { lt: parsed.before.createdAt } },
                {
                  createdAt: parsed.before.createdAt,
                  id: { lt: parsed.before.membershipId },
                },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, id: true, userId: true },
    take: parsed.limit + 1,
  })
  const administrators = rows.slice(0, parsed.limit)
  const last = administrators.at(-1)
  return {
    administrators: administrators.map(({ createdAt, id, userId }) => ({
      createdAt,
      membershipId: id,
      userId,
    })),
    nextCursor:
      rows.length > parsed.limit && last
        ? { createdAt: last.createdAt, membershipId: last.id }
        : null,
  }
}

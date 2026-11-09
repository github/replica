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
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: z.input<typeof inputSchema> = {},
) {
  const parsed = inputSchema.parse(input)
  const rows = await database.$queryRaw<
    Array<{ createdAt: Date; membershipId: string; userId: string }>
  >`
    SELECT
      membership."created_at" AS "createdAt",
      membership."id" AS "membershipId",
      membership."user_id" AS "userId"
    FROM "memberships" membership
    WHERE membership."lifecycle" = 'ACTIVE'
      AND (
        ${parsed.before?.createdAt ?? null}::timestamptz IS NULL
        OR (membership."created_at", membership."id") <
          (${parsed.before?.createdAt ?? null}::timestamptz, ${parsed.before?.membershipId ?? null}::uuid)
      )
      AND EXISTS (
        SELECT 1
        FROM "membership_assignments" assignment
        LEFT JOIN "authentication_provider_revisions" revision
          ON revision."id" = assignment."provider_revision_id"
        LEFT JOIN "authentication_providers" provider
          ON provider."id" = revision."provider_id"
        WHERE assignment."membership_id" = membership."id"
          AND assignment."lifecycle" = 'ACTIVE'
          AND assignment."role" = 'ADMINISTRATOR'
          AND (
            assignment."source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
            OR (
              assignment."source" = 'AUTHENTICATION_PROVIDER'
              AND provider."enabled" = true
              AND provider."selected_revision_id" = assignment."provider_revision_id"
            )
          )
      )
    ORDER BY membership."created_at" DESC, membership."id" DESC
    LIMIT ${parsed.limit + 1}
  `
  const administrators = rows.slice(0, parsed.limit)
  const last = administrators.at(-1)
  return {
    administrators,
    nextCursor:
      rows.length > parsed.limit && last
        ? { createdAt: last.createdAt, membershipId: last.membershipId }
        : null,
  }
}

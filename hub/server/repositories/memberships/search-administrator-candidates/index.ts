import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    query: z.string().trim().min(1).max(100),
  })
  .strict()

export async function searchAdministratorCandidates(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: z.input<typeof inputSchema>,
) {
  const parsed = inputSchema.parse(input)
  return database.$queryRaw<
    Array<{
      login: string
      membershipId: string
      name: string | null
      provider: string
    }>
  >`
    SELECT
      membership."id" AS "membershipId",
      profile."provider",
      profile."login",
      profile."name"
    FROM "memberships" membership
    JOIN "user_profiles" profile ON profile."user_id" = membership."user_id"
    WHERE membership."lifecycle" = 'ACTIVE'
      AND (
        strpos(lower(profile."login"), lower(${parsed.query})) > 0
        OR strpos(lower(profile."name"), lower(${parsed.query})) > 0
      )
      AND NOT EXISTS (
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
    ORDER BY lower(profile."login"), membership."id"
    LIMIT ${parsed.limit}
  `
}

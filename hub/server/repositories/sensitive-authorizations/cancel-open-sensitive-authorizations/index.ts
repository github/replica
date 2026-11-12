import type { Prisma } from "../../../generated/prisma/client.ts"

export async function cancelOpenSensitiveAuthorizations(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  continuedAuthorizationId: string,
) {
  const rows = await database.$queryRaw<Array<{ count: bigint }>>`
    WITH authorization_clock AS (
      SELECT clock_timestamp() AS value
    ),
    cancelled AS (
      UPDATE "sensitive_authorizations"
      SET
        "cancelled_at" = (SELECT value FROM authorization_clock),
        "updated_at" = (SELECT value FROM authorization_clock)
      WHERE "id" <> ${continuedAuthorizationId}::uuid
        AND "continued_at" IS NULL
        AND "cancelled_at" IS NULL
      RETURNING "id"
    )
    SELECT count(*) AS "count" FROM cancelled
  `
  return Number(rows[0]?.count ?? 0)
}

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function advanceGitHubRepositoryAccessState(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<Array<{ revision: number; changedAt: Date }>>`
    UPDATE "github_repository_access_states"
    SET
      "revision" = "revision" + 1,
      "changed_at" = GREATEST(
        clock_timestamp(),
        "changed_at" + interval '1 millisecond',
        (
          SELECT MAX(evidence."last_issued_at") + interval '1 millisecond'
          FROM "provider_evidence_states" AS evidence
          JOIN "external_identities" AS identity ON identity."id" = evidence."external_identity_id"
          WHERE identity."provider" = 'github'
        )
      ),
      "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 millisecond')
    WHERE "key" = 'global'
    RETURNING "revision", "changed_at" AS "changedAt"
  `
  if (!rows[0]) throw new Error("GitHub repository access authority is missing.")
  return rows[0]
}

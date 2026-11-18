import { Prisma } from "../../../generated/prisma/client.ts"

export function deleteExpiredLearningRuns(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  cutoff: Date,
) {
  return database.$executeRaw(Prisma.sql`
    DELETE FROM learning_runs
    WHERE state IN ('SUCCEEDED', 'FAILED')
      AND finished_at < ${cutoff}
      AND id NOT IN (
        SELECT id
        FROM (
          SELECT DISTINCT ON (repository_id) id
          FROM learning_runs
          ORDER BY repository_id, created_at DESC, number DESC
        ) latest_runs
        UNION
        SELECT id
        FROM (
          SELECT DISTINCT ON (repository_id) id
          FROM learning_runs
          WHERE state = 'SUCCEEDED'
          ORDER BY repository_id, finished_at DESC, number DESC
        ) latest_successes
      )
  `)
}

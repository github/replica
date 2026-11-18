import { Prisma } from "../../../generated/prisma/client.ts"

export function listDueLearningRepositories(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { requireGitHubId: boolean; limit?: number },
) {
  const limit = input.limit ?? 2_000
  return database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH latest_runs AS (
      SELECT DISTINCT ON (repository_id)
        repository_id,
        created_at,
        comments_remaining,
        suggestions_remaining
      FROM learning_runs
      ORDER BY repository_id, created_at DESC, number DESC
    ),
    latest_successes AS (
      SELECT DISTINCT ON (repository_id)
        repository_id,
        finished_at,
        comments_remaining,
        suggestions_remaining
      FROM learning_runs
      WHERE state = 'SUCCEEDED'
      ORDER BY repository_id, finished_at DESC, number DESC
    )
    SELECT repositories.id
    FROM repositories
    LEFT JOIN latest_runs
      ON latest_runs.repository_id = repositories.id
    LEFT JOIN latest_successes
      ON latest_successes.repository_id = repositories.id
    WHERE repositories.removed_at IS NULL
      AND (${input.requireGitHubId} = false OR repositories.github_repository_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM learning_runs active_runs
        WHERE active_runs.repository_id = repositories.id
          AND active_runs.state IN ('QUEUED', 'RUNNING')
      )
      AND (
        COALESCE(latest_runs.comments_remaining, 0) > 0
        OR COALESCE(latest_runs.suggestions_remaining, 0) > 0
        OR COALESCE(latest_successes.comments_remaining, 0) > 0
        OR COALESCE(latest_successes.suggestions_remaining, 0) > 0
        OR EXISTS (
          SELECT 1
          FROM review_threads
          WHERE review_threads.repository_id = repositories.id
            AND (
              review_threads.updated_at > COALESCE(
                latest_successes.finished_at,
                '-infinity'::timestamptz
              )
              OR EXISTS (
                SELECT 1
                FROM review_comments
                WHERE review_comments.thread_id = review_threads.id
                  AND review_comments.updated_at > COALESCE(
                    latest_successes.finished_at,
                    '-infinity'::timestamptz
                  )
              )
              OR EXISTS (
                SELECT 1
                FROM review_thread_resolution_events
                WHERE review_thread_resolution_events.thread_id = review_threads.id
                  AND review_thread_resolution_events.occurred_at > COALESCE(
                    latest_successes.finished_at,
                    '-infinity'::timestamptz
                  )
              )
            )
        )
      )
    ORDER BY latest_runs.created_at ASC NULLS FIRST, repositories.id ASC
    LIMIT ${limit}
  `)
}

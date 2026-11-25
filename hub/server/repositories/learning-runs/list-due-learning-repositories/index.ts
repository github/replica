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
        review_activity_snapshot,
        comments_remaining,
        suggestions_remaining
      FROM learning_runs
      WHERE state = 'SUCCEEDED'
      ORDER BY repository_id, finished_at DESC, number DESC
    ),
    latest_automatic_runs AS (
      SELECT DISTINCT ON (repository_id)
        repository_id,
        created_at,
        number,
        state,
        failure_code
      FROM learning_runs
      WHERE scheduled = true
      ORDER BY repository_id, created_at DESC, number DESC
    ),
    latest_explicit_runs AS (
      SELECT DISTINCT ON (repository_id)
        repository_id,
        created_at,
        number
      FROM learning_runs
      WHERE scheduled = false
        AND requested_by_membership_id IS NOT NULL
      ORDER BY repository_id, created_at DESC, number DESC
    )
    SELECT repositories.id
    FROM repositories
    LEFT JOIN latest_runs
      ON latest_runs.repository_id = repositories.id
    LEFT JOIN latest_successes
      ON latest_successes.repository_id = repositories.id
    LEFT JOIN latest_automatic_runs
      ON latest_automatic_runs.repository_id = repositories.id
    LEFT JOIN latest_explicit_runs
      ON latest_explicit_runs.repository_id = repositories.id
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(id::text, activity_version) AS snapshot
      FROM review_threads
      WHERE review_threads.repository_id = repositories.id
    ) review_activity ON true
    WHERE repositories.removed_at IS NULL
      AND (${input.requireGitHubId} = false OR repositories.github_repository_id > 0)
      AND NOT EXISTS (
        SELECT 1
        FROM learning_runs active_runs
        WHERE active_runs.repository_id = repositories.id
          AND active_runs.state IN ('QUEUED', 'RUNNING')
      )
      AND NOT (
        latest_automatic_runs.repository_id IS NOT NULL
        AND latest_automatic_runs.state = 'FAILED'
        AND latest_automatic_runs.failure_code IN ('grant_required', 'grant_inactive')
        AND (
          latest_explicit_runs.number IS NULL
          OR (latest_explicit_runs.created_at, latest_explicit_runs.number)
            < (latest_automatic_runs.created_at, latest_automatic_runs.number)
        )
      )
      AND (
        COALESCE(latest_runs.comments_remaining, 0) > 0
        OR COALESCE(latest_runs.suggestions_remaining, 0) > 0
        OR COALESCE(latest_successes.comments_remaining, 0) > 0
        OR COALESCE(latest_successes.suggestions_remaining, 0) > 0
        OR (
          review_activity.snapshot IS NOT NULL
          AND review_activity.snapshot IS DISTINCT FROM latest_successes.review_activity_snapshot
        )
      )
    ORDER BY latest_runs.created_at ASC NULLS FIRST, repositories.id ASC
    LIMIT ${limit}
  `)
}

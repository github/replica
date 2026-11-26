import { randomUUID } from "node:crypto"
import type { Client } from "pg"

interface Snapshot {
  digest: string
  snapshotId: string
  capturedAt: Date
}

/** Keep the checkpoint write on the session that owns the execution lock. */
export async function saveDecisionReviewSnapshot(
  database: Pick<Client, "query">,
  repositoryId: string,
  snapshot: Snapshot,
  previous: Snapshot | null,
) {
  // Prisma cannot use the session holding the advisory lock.
  const result = previous
    ? await database.query(
        `UPDATE decision_review_snapshots
         SET digest = $1, snapshot_id = $2, captured_at = $3, updated_at = CURRENT_TIMESTAMP
         WHERE repository_id = $4 AND digest = $5 AND snapshot_id = $6 AND captured_at = $7`,
        [
          snapshot.digest,
          snapshot.snapshotId,
          snapshot.capturedAt,
          repositoryId,
          previous.digest,
          previous.snapshotId,
          previous.capturedAt,
        ],
      )
    : await database.query(
        `INSERT INTO decision_review_snapshots
         (id, repository_id, digest, snapshot_id, captured_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (repository_id) DO NOTHING`,
        [randomUUID(), repositoryId, snapshot.digest, snapshot.snapshotId, snapshot.capturedAt],
      )
  return result.rowCount === 1
}

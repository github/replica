import { randomUUID } from "node:crypto"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { captureRepositoryReviewSnapshotRecords } from "../../../repositories/review-comments/capture-repository-review-snapshot/index.ts"
import { ReviewCommentError } from "../errors.ts"
import { serializeReviewThread } from "../serialize-review-thread/index.ts"
import type { RepositoryReviewSnapshot } from "../types.ts"

export async function captureRepositoryReviewSnapshot(
  database: Pick<PrismaClient, "$transaction">,
  repositoryId: string,
  capturedAt = new Date(),
): Promise<RepositoryReviewSnapshot> {
  const records = await captureRepositoryReviewSnapshotRecords(database, repositoryId)
  if (!records) throw new ReviewCommentError("not_found", "Repository not found.")
  return {
    snapshotId: randomUUID(),
    capturedAt,
    repository: records.repository,
    threads: records.threads.map(serializeReviewThread),
  }
}

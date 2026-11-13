CREATE TYPE "LearningRunState" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "review_comments"
ADD COLUMN "learning_redaction_actor" VARCHAR(300),
ADD COLUMN "learning_redacted_at" TIMESTAMPTZ(3);

CREATE INDEX "review_comments_pending_learning_redaction_idx"
ON "review_comments"("deleted_at", "id")
WHERE "deleted_at" IS NOT NULL AND "learning_redacted_at" IS NULL;

CREATE TABLE "learning_runs" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "number" SERIAL NOT NULL,
    "scheduled" BOOLEAN NOT NULL DEFAULT false,
    "state" "LearningRunState" NOT NULL DEFAULT 'QUEUED',
    "comments_considered" INTEGER NOT NULL DEFAULT 0,
    "comments_labeled" INTEGER NOT NULL DEFAULT 0,
    "comments_remaining" INTEGER NOT NULL DEFAULT 0,
    "suggestions" INTEGER NOT NULL DEFAULT 0,
    "suggestions_remaining" INTEGER NOT NULL DEFAULT 0,
    "copilot_requests" INTEGER NOT NULL DEFAULT 0,
    "ai_credits" DECIMAL(20,9) NOT NULL DEFAULT 0,
    "snapshot_digest" VARCHAR(71) NOT NULL,
    "failure_code" VARCHAR(60),
    "failure_summary" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_runs_counts_check" CHECK (
      "comments_considered" >= 0 AND
      "comments_labeled" >= 0 AND
      "comments_remaining" >= 0 AND
      "suggestions" >= 0 AND
      "suggestions_remaining" >= 0 AND
      "copilot_requests" >= 0 AND
      "ai_credits" >= 0
    ),
    CONSTRAINT "learning_runs_snapshot_digest_check" CHECK (
      "snapshot_digest" ~ '^sha256:[0-9a-f]{64}$'
    ),
    CONSTRAINT "learning_runs_result_check" CHECK (
      ("state" = 'FAILED' AND "failure_code" IS NOT NULL AND "failure_summary" IS NOT NULL AND "finished_at" IS NOT NULL) OR
      ("state" = 'SUCCEEDED' AND "started_at" IS NOT NULL AND "failure_code" IS NULL AND "failure_summary" IS NULL AND "finished_at" IS NOT NULL) OR
      ("state" = 'QUEUED' AND "started_at" IS NULL AND "failure_code" IS NULL AND "failure_summary" IS NULL AND "finished_at" IS NULL) OR
      ("state" = 'RUNNING' AND "started_at" IS NOT NULL AND "failure_code" IS NULL AND "failure_summary" IS NULL AND "finished_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "learning_runs_number_key" ON "learning_runs"("number");
CREATE INDEX "learning_runs_requested_by_id_idx" ON "learning_runs"("requested_by_id");
CREATE INDEX "learning_runs_repository_id_created_at_idx" ON "learning_runs"("repository_id", "created_at");
CREATE UNIQUE INDEX "learning_runs_active_repository_key"
ON "learning_runs"("repository_id")
WHERE "state" IN ('QUEUED', 'RUNNING');

ALTER TABLE "learning_runs"
ADD CONSTRAINT "learning_runs_repository_id_fkey"
FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_runs"
ADD CONSTRAINT "learning_runs_requested_by_id_fkey"
FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

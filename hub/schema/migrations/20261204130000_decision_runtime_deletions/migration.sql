CREATE TYPE "DecisionRuntimeDeletionState" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "decision_runtime_copies" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "runtime_copy_id" VARCHAR(200) NOT NULL,
  "kind" VARCHAR(50) NOT NULL,
  "runtime_connector" VARCHAR(200) NOT NULL,
  "runtime_reference" VARCHAR(500) NOT NULL,
  "export_id" VARCHAR(255),
  "grant_ids" JSONB NOT NULL,
  "evidence_digest" VARCHAR(71),
  "taskset_digest" VARCHAR(71),
  "use_state" VARCHAR(50) NOT NULL,
  "promotion_state" VARCHAR(50),
  "retention" JSONB NOT NULL,
  "runtime_created_at" TIMESTAMPTZ(3),
  "disclosed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_runtime_copies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_runtime_deletions" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "requested_by_membership_id" UUID NOT NULL,
  "runtime_deletion_id" VARCHAR(200),
  "idempotency_key" VARCHAR(100) NOT NULL,
  "state" "DecisionRuntimeDeletionState" NOT NULL DEFAULT 'PENDING',
  "export_id" VARCHAR(255),
  "grant_id" VARCHAR(255),
  "evidence_digest" VARCHAR(71),
  "taskset_digest" VARCHAR(71),
  "reason" VARCHAR(500) NOT NULL,
  "pending_count" INTEGER NOT NULL DEFAULT 0,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "receipt" JSONB,
  "failure_code" VARCHAR(100),
  "revoked_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_runtime_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_runtime_deletion_selector_check" CHECK (
    "export_id" IS NOT NULL OR "grant_id" IS NOT NULL
    OR "evidence_digest" IS NOT NULL OR "taskset_digest" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "decision_runtime_copy_identity"
  ON "decision_runtime_copies"("repository_id", "runtime_copy_id");
CREATE INDEX "decision_runtime_copies_repository_id_export_id_idx"
  ON "decision_runtime_copies"("repository_id", "export_id");
CREATE INDEX "decision_runtime_copies_repository_id_taskset_digest_idx"
  ON "decision_runtime_copies"("repository_id", "taskset_digest");
CREATE UNIQUE INDEX "decision_runtime_deletion_request"
  ON "decision_runtime_deletions"("repository_id", "idempotency_key");
CREATE UNIQUE INDEX "decision_runtime_deletion_identity"
  ON "decision_runtime_deletions"("repository_id", "runtime_deletion_id");
CREATE INDEX "decision_runtime_deletions_state_updated_at_idx"
  ON "decision_runtime_deletions"("state", "updated_at");

ALTER TABLE "decision_runtime_copies"
  ADD CONSTRAINT "decision_runtime_copies_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_runtime_deletions"
  ADD CONSTRAINT "decision_runtime_deletions_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_runtime_deletions"
  ADD CONSTRAINT "decision_runtime_deletions_requested_by_membership_id_fkey"
  FOREIGN KEY ("requested_by_membership_id") REFERENCES "memberships"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

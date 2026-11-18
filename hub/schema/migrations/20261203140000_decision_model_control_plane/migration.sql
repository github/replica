CREATE TYPE "DecisionTrainingJobState" AS ENUM (
  'QUEUED',
  'SUBMITTED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "DecisionPromotionOperation" AS ENUM ('PROMOTE', 'ROLLBACK');

CREATE TABLE "decision_model_configurations" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "backend" VARCHAR(100) NOT NULL,
  "max_updates" INTEGER NOT NULL,
  "max_seconds" INTEGER NOT NULL,
  "monthly_budget_credits" DECIMAL(20,9) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_model_configurations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_model_configurations_bounds_check" CHECK (
    "generation" > 0
    AND "max_updates" BETWEEN 1 AND 100000
    AND "max_seconds" BETWEEN 1 AND 86400
    AND "monthly_budget_credits" >= 0
  )
);

CREATE TABLE "decision_training_jobs" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "requested_by_membership_id" UUID,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "runtime_job_id" VARCHAR(100),
  "runtime_taskset_id" VARCHAR(100),
  "configuration_generation" INTEGER NOT NULL,
  "state" "DecisionTrainingJobState" NOT NULL DEFAULT 'QUEUED',
  "backend" VARCHAR(100) NOT NULL,
  "max_updates" INTEGER NOT NULL,
  "max_seconds" INTEGER NOT NULL,
  "budget_credits" DECIMAL(20,9) NOT NULL,
  "consent_grant_id" VARCHAR(255) NOT NULL,
  "export_digest" VARCHAR(71) NOT NULL,
  "repeatable_review_snapshot_digest" VARCHAR(71) NOT NULL,
  "question_digest" VARCHAR(71) NOT NULL,
  "build_set_digest" VARCHAR(71) NOT NULL,
  "taskset_digest" VARCHAR(71) NOT NULL,
  "candidate_runtime_id" VARCHAR(100),
  "failure_code" VARCHAR(100),
  "usage_quantity" DECIMAL(20,9),
  "usage_unit" VARCHAR(50),
  "cost_amount" DECIMAL(20,9),
  "cost_currency" VARCHAR(3),
  "submitted_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_training_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_training_jobs_bounds_check" CHECK (
    "configuration_generation" > 0
    AND "max_updates" BETWEEN 1 AND 100000
    AND "max_seconds" BETWEEN 1 AND 86400
    AND "budget_credits" >= 0
    AND ("usage_quantity" IS NULL OR "usage_quantity" >= 0)
    AND ("cost_amount" IS NULL OR "cost_amount" >= 0)
    AND (("usage_quantity" IS NULL) = ("usage_unit" IS NULL))
    AND (("cost_amount" IS NULL) = ("cost_currency" IS NULL))
  )
);

CREATE TABLE "decision_candidates" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "training_job_id" UUID NOT NULL,
  "runtime_candidate_id" VARCHAR(100) NOT NULL,
  "taskset_digest" VARCHAR(71) NOT NULL,
  "manifest_digest" VARCHAR(71) NOT NULL,
  "evaluation_digest" VARCHAR(71) NOT NULL,
  "production_eligible" BOOLEAN NOT NULL,
  "mean_reward_delta" DECIMAL(20,9),
  "calibration_error_delta" DECIMAL(20,9),
  "usage_quantity" DECIMAL(20,9),
  "usage_unit" VARCHAR(50),
  "cost_amount" DECIMAL(20,9),
  "cost_currency" VARCHAR(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_candidates_usage_check" CHECK (
    ("usage_quantity" IS NULL OR "usage_quantity" >= 0)
    AND ("cost_amount" IS NULL OR "cost_amount" >= 0)
    AND (("usage_quantity" IS NULL) = ("usage_unit" IS NULL))
    AND (("cost_amount" IS NULL) = ("cost_currency" IS NULL))
  )
);

CREATE TABLE "decision_model_promotions" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "previous_candidate_id" UUID,
  "promoted_by_membership_id" UUID,
  "runtime_generation" BIGINT NOT NULL,
  "operation" "DecisionPromotionOperation" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_model_promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_model_promotions_generation_check" CHECK ("runtime_generation" > 0)
);

CREATE TABLE "decision_build_evaluations" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "build_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "runtime_evaluation_id" VARCHAR(100),
  "promotion_generation" BIGINT NOT NULL,
  "question_digest" VARCHAR(71) NOT NULL,
  "screenshot_set_digest" VARCHAR(71) NOT NULL,
  "response_digest" VARCHAR(71) NOT NULL,
  "summary" JSONB NOT NULL,
  "usage_quantity" DECIMAL(20,9),
  "usage_unit" VARCHAR(50),
  "cost_amount" DECIMAL(20,9),
  "cost_currency" VARCHAR(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_build_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_build_evaluations_usage_check" CHECK (
    "promotion_generation" > 0
    AND ("usage_quantity" IS NULL OR "usage_quantity" >= 0)
    AND ("cost_amount" IS NULL OR "cost_amount" >= 0)
    AND (("usage_quantity" IS NULL) = ("usage_unit" IS NULL))
    AND (("cost_amount" IS NULL) = ("cost_currency" IS NULL))
  )
);

CREATE UNIQUE INDEX "decision_model_configurations_repository_id_key"
  ON "decision_model_configurations"("repository_id");
CREATE UNIQUE INDEX "decision_training_jobs_repository_id_idempotency_key_key"
  ON "decision_training_jobs"("repository_id", "idempotency_key");
CREATE UNIQUE INDEX "decision_training_jobs_repository_id_runtime_job_id_key"
  ON "decision_training_jobs"("repository_id", "runtime_job_id");
CREATE INDEX "decision_training_jobs_repository_id_created_at_idx"
  ON "decision_training_jobs"("repository_id", "created_at");
CREATE INDEX "decision_training_jobs_state_updated_at_idx"
  ON "decision_training_jobs"("state", "updated_at");
CREATE UNIQUE INDEX "decision_candidates_training_job_id_key"
  ON "decision_candidates"("training_job_id");
CREATE UNIQUE INDEX "decision_candidates_repository_id_runtime_candidate_id_key"
  ON "decision_candidates"("repository_id", "runtime_candidate_id");
CREATE INDEX "decision_candidates_repository_id_created_at_idx"
  ON "decision_candidates"("repository_id", "created_at");
CREATE UNIQUE INDEX "decision_model_promotions_repository_id_runtime_generation_key"
  ON "decision_model_promotions"("repository_id", "runtime_generation");
CREATE INDEX "decision_model_promotions_repository_id_created_at_idx"
  ON "decision_model_promotions"("repository_id", "created_at");
CREATE UNIQUE INDEX "decision_build_evaluations_build_id_promotion_generation_question_digest_screenshot_set_digest_key"
  ON "decision_build_evaluations"(
    "build_id",
    "promotion_generation",
    "question_digest",
    "screenshot_set_digest"
  );
CREATE INDEX "decision_build_evaluations_repository_id_created_at_idx"
  ON "decision_build_evaluations"("repository_id", "created_at");

ALTER TABLE "decision_model_configurations"
  ADD CONSTRAINT "decision_model_configurations_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_training_jobs"
  ADD CONSTRAINT "decision_training_jobs_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_training_jobs"
  ADD CONSTRAINT "decision_training_jobs_requested_by_membership_id_fkey"
  FOREIGN KEY ("requested_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decision_candidates"
  ADD CONSTRAINT "decision_candidates_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_candidates"
  ADD CONSTRAINT "decision_candidates_training_job_id_fkey"
  FOREIGN KEY ("training_job_id") REFERENCES "decision_training_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_model_promotions"
  ADD CONSTRAINT "decision_model_promotions_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_model_promotions"
  ADD CONSTRAINT "decision_model_promotions_candidate_id_fkey"
  FOREIGN KEY ("candidate_id") REFERENCES "decision_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_model_promotions"
  ADD CONSTRAINT "decision_model_promotions_previous_candidate_id_fkey"
  FOREIGN KEY ("previous_candidate_id") REFERENCES "decision_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_model_promotions"
  ADD CONSTRAINT "decision_model_promotions_promoted_by_membership_id_fkey"
  FOREIGN KEY ("promoted_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decision_build_evaluations"
  ADD CONSTRAINT "decision_build_evaluations_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_build_evaluations"
  ADD CONSTRAINT "decision_build_evaluations_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_build_evaluations"
  ADD CONSTRAINT "decision_build_evaluations_candidate_id_fkey"
  FOREIGN KEY ("candidate_id") REFERENCES "decision_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

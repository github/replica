CREATE TABLE "decision_agent_evaluations" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "cache_key" CHAR(64) NOT NULL,
  "promotion_generation" BIGINT NOT NULL,
  "question_digest" VARCHAR(71) NOT NULL,
  "screenshot_set_digest" VARCHAR(71) NOT NULL,
  "reserved_credits" DECIMAL(20,9) NOT NULL,
  "result" JSONB,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_agent_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_agent_evaluations_repository_id_fkey"
    FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "decision_agent_evaluations_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "decision_candidates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "decision_agent_evaluations_reserved_credits_check"
    CHECK ("reserved_credits" > 0),
  CONSTRAINT "decision_agent_evaluations_promotion_generation_check"
    CHECK ("promotion_generation" >= 0)
);

CREATE UNIQUE INDEX "decision_agent_evaluations_cache_key_key"
  ON "decision_agent_evaluations"("cache_key");

CREATE INDEX "decision_agent_evaluations_repository_id_created_at_idx"
  ON "decision_agent_evaluations"("repository_id", "created_at");

CREATE INDEX "decision_agent_evaluations_expires_at_idx"
  ON "decision_agent_evaluations"("expires_at");

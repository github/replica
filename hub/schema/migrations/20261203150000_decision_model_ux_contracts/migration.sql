ALTER TABLE "decision_candidates"
  ADD COLUMN "rejected_by_membership_id" UUID,
  ADD COLUMN "baseline_mean_reward" DECIMAL(20,9),
  ADD COLUMN "candidate_mean_reward" DECIMAL(20,9),
  ADD COLUMN "baseline_calibration_error" DECIMAL(20,9),
  ADD COLUMN "candidate_calibration_error" DECIMAL(20,9),
  ADD COLUMN "learning_metrics" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "duration_seconds" DECIMAL(20,3),
  ADD COLUMN "rejected_reason" VARCHAR(500),
  ADD COLUMN "rejected_at" TIMESTAMPTZ(3);

ALTER TABLE "decision_candidates"
  ADD CONSTRAINT "decision_candidates_rejected_by_membership_id_fkey"
  FOREIGN KEY ("rejected_by_membership_id") REFERENCES "memberships"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decision_candidates"
  ADD CONSTRAINT "decision_candidates_rejection_check" CHECK (
    ("rejected_at" IS NULL AND "rejected_reason" IS NULL AND "rejected_by_membership_id" IS NULL)
    OR
    ("rejected_at" IS NOT NULL AND "rejected_reason" IS NOT NULL)
  );

ALTER TABLE "builds"
ADD COLUMN "github_workflow_run_id" BIGINT,
ADD COLUMN "github_workflow_run_attempt" INTEGER,
ADD COLUMN "workflow_url" VARCHAR(2048),
ADD COLUMN "workflow_completed_at" TIMESTAMPTZ(3),
ADD COLUMN "dist_digest" VARCHAR(71);

ALTER TABLE "builds"
ADD CONSTRAINT "builds_dist_digest_check"
CHECK ("dist_digest" IS NULL OR "dist_digest" ~ '^sha256:[0-9a-f]{64}$');

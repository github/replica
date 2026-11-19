ALTER TABLE "repositories"
ADD COLUMN "hosted_branch_scan" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "builds"
ADD COLUMN "github_workflow_run_id" BIGINT,
ADD COLUMN "github_workflow_run_attempt" INTEGER,
ADD COLUMN "github_workflow_completed_at" TIMESTAMPTZ(3),
ADD COLUMN "github_artifact_id" BIGINT,
ADD COLUMN "hosted_import_lease_id" UUID,
ADD COLUMN "hosted_import_lease_expires_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "builds_github_workflow_run_id_key" ON "builds"("github_workflow_run_id");

ALTER TABLE "builds"
ADD CONSTRAINT "builds_github_workflow_identity_check" CHECK (
    ("github_workflow_run_id" IS NULL AND "github_workflow_run_attempt" IS NULL
     AND "github_workflow_completed_at" IS NULL AND "github_artifact_id" IS NULL)
    OR ("github_workflow_run_id" IS NOT NULL AND "github_workflow_run_id" > 0
        AND "github_workflow_run_attempt" IS NOT NULL AND "github_workflow_run_attempt" > 0
        AND "commit_sha" IS NOT NULL AND "workflow_created_at" IS NOT NULL
        AND "local_lease_id" IS NULL
        AND ("github_artifact_id" IS NULL OR
             ("github_artifact_id" > 0 AND "github_workflow_completed_at" IS NOT NULL)))
),
ADD CONSTRAINT "builds_hosted_import_lease_check" CHECK (
    ("hosted_import_lease_id" IS NULL AND "hosted_import_lease_expires_at" IS NULL)
    OR ("hosted_import_lease_id" IS NOT NULL AND "hosted_import_lease_expires_at" IS NOT NULL
        AND "github_workflow_completed_at" IS NOT NULL AND "state" = 'running')
);

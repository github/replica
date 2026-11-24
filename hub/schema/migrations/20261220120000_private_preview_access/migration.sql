CREATE TABLE "private_preview_access" (
    "token_digest" CHAR(64) NOT NULL,
    "build_id" UUID NOT NULL,
    "session_digest" CHAR(64) NOT NULL,
    "reader_origin" VARCHAR(255) NOT NULL,
    "challenge_digest" CHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "private_preview_access_pkey" PRIMARY KEY ("token_digest")
);

CREATE INDEX "private_preview_access_expires_at_idx" ON "private_preview_access"("expires_at");

CREATE INDEX "builds_github_workflow_run_id_idx" ON "builds"("github_workflow_run_id");

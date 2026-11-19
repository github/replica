ALTER TABLE "prototypes"
ADD COLUMN "retired_head_sha" VARCHAR(64),
ADD COLUMN "branch_head_sha" VARCHAR(64),
ADD COLUMN "branch_presence_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "branch_identity_started_at" TIMESTAMPTZ(3);

-- Existing retirements have no proven deleted head, so a returning branch gets a
-- separate identity rather than resuming on unverified evidence.

CREATE INDEX "prototypes_branch_identity_idx"
ON "prototypes" ("repository_id", "branch_name", "branch_deleted_at" DESC,
                 "branch_presence_revision" DESC, "id" DESC);

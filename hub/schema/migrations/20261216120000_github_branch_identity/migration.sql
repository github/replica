ALTER TABLE "prototypes"
ADD COLUMN "retired_head_sha" VARCHAR(64),
ADD COLUMN "branch_head_sha" VARCHAR(64),
ADD COLUMN "branch_presence_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "branch_identity_started_at" TIMESTAMPTZ(3);

-- Only the selected Build is evidence of the retired head; historical Builds are not.
UPDATE "prototypes" AS prototype
SET "retired_head_sha" = build."commit_sha"
FROM "builds" AS build
WHERE prototype."branch_deleted_at" IS NOT NULL
  AND prototype."current_build_id" = build."id";

CREATE INDEX "prototypes_branch_identity_idx"
ON "prototypes" ("repository_id", "branch_name", "branch_deleted_at" DESC,
                 "branch_presence_revision" DESC, "id" DESC);

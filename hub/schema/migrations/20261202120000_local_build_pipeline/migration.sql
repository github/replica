CREATE TYPE "BuildArtifactKind" AS ENUM ('dist', 'screenshot', 'manifest');

ALTER TABLE "repositories"
ADD COLUMN "local_path" VARCHAR(2048);

CREATE UNIQUE INDEX "repositories_local_path_key"
ON "repositories"("local_path");

CREATE TABLE "build_artifacts" (
    "id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "kind" "BuildArtifactKind" NOT NULL,
    "path" VARCHAR(2048) NOT NULL,
    "storage_key" VARCHAR(128) NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "build_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "build_artifacts_byte_length_check" CHECK ("byte_length" >= 0)
);

CREATE UNIQUE INDEX "build_artifacts_storage_key_key"
ON "build_artifacts"("storage_key");

CREATE UNIQUE INDEX "build_artifacts_build_id_path_key"
ON "build_artifacts"("build_id", "path");

CREATE TABLE "branch_head_observations" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "branch_name" VARCHAR(255) NOT NULL,
    "commit_sha" VARCHAR(64) NOT NULL,
    "last_observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_head_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_head_observations_commit_sha_check"
      CHECK ("commit_sha" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')
);

CREATE UNIQUE INDEX "branch_head_observations_repository_branch_commit_key"
ON "branch_head_observations"("repository_id", "branch_name", "commit_sha");

CREATE INDEX "branch_head_observations_repository_branch_last_observed_idx"
ON "branch_head_observations"("repository_id", "branch_name", "last_observed_at");

ALTER TABLE "build_artifacts"
ADD CONSTRAINT "build_artifacts_build_id_fkey"
FOREIGN KEY ("build_id") REFERENCES "builds"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "branch_head_observations"
ADD CONSTRAINT "branch_head_observations_repository_id_fkey"
FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "branch_head_observations"
ADD CONSTRAINT "branch_head_observations_build_id_fkey"
FOREIGN KEY ("build_id") REFERENCES "builds"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

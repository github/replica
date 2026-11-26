-- CreateEnum
CREATE TYPE "LearningScoreTrigger" AS ENUM ('USAGE', 'REVIEWER_VERIFICATION');

-- DropIndex
DROP INDEX "learning_evaluation_runs_repository_id_used_learning_id_key";

-- AlterTable
ALTER TABLE "learning_evaluation_runs" ADD COLUMN     "trigger" "LearningScoreTrigger" NOT NULL DEFAULT 'USAGE';

-- CreateTable
CREATE TABLE "learning_reviewer_verifications" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "commit_sha" VARCHAR(64) NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_reviewer_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_reviewer_verifications_repository_id_commit_sha_idx" ON "learning_reviewer_verifications"("repository_id", "commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "learning_reviewer_verifications_prototype_id_commit_sha_key" ON "learning_reviewer_verifications"("prototype_id", "commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "learning_evaluation_runs_repository_id_used_learning_id_tri_key" ON "learning_evaluation_runs"("repository_id", "used_learning_id", "trigger");

-- AddForeignKey
ALTER TABLE "learning_reviewer_verifications" ADD CONSTRAINT "learning_reviewer_verifications_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_reviewer_verifications" ADD CONSTRAINT "learning_reviewer_verifications_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

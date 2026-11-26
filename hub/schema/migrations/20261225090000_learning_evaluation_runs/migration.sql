-- AlterTable
ALTER TABLE "repository_evaluation_settings" ADD COLUMN     "evaluation_grant_id" VARCHAR(255);

-- CreateTable
CREATE TABLE "learning_evaluation_runs" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "used_learning_id" VARCHAR(255) NOT NULL,
    "operation_id" UUID NOT NULL,
    "state" "LearningRunState" NOT NULL DEFAULT 'RUNNING',
    "copilot_requests" INTEGER NOT NULL DEFAULT 0,
    "ai_credits" DECIMAL(20,9) NOT NULL DEFAULT 0,
    "score_id" VARCHAR(255),
    "failure_code" VARCHAR(60),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_score_requests" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "commit_sha" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_score_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learning_evaluation_runs_operation_id_key" ON "learning_evaluation_runs"("operation_id");

-- CreateIndex
CREATE INDEX "learning_evaluation_runs_finished_at_idx" ON "learning_evaluation_runs"("finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "learning_evaluation_runs_repository_id_used_learning_id_key" ON "learning_evaluation_runs"("repository_id", "used_learning_id");

-- CreateIndex
CREATE INDEX "learning_score_requests_created_at_idx" ON "learning_score_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "learning_score_requests_repository_id_commit_sha_key" ON "learning_score_requests"("repository_id", "commit_sha");

-- AddForeignKey
ALTER TABLE "learning_evaluation_runs" ADD CONSTRAINT "learning_evaluation_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_score_requests" ADD CONSTRAINT "learning_score_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


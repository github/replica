-- CreateTable
CREATE TABLE "learning_update_requests" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "memory_id" VARCHAR(255) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_update_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_update_runs" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "memory_id" VARCHAR(255) NOT NULL,
    "state" "LearningRunState" NOT NULL DEFAULT 'RUNNING',
    "result" VARCHAR(30),
    "copilot_requests" INTEGER NOT NULL DEFAULT 0,
    "ai_credits" DECIMAL(20,9) NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(60),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_update_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learning_update_requests_repository_id_memory_id_key" ON "learning_update_requests"("repository_id", "memory_id");

-- CreateIndex
CREATE INDEX "learning_update_runs_finished_at_idx" ON "learning_update_runs"("finished_at");

-- CreateIndex
CREATE INDEX "learning_update_runs_repository_id_memory_id_created_at_idx" ON "learning_update_runs"("repository_id", "memory_id", "created_at");

-- AddForeignKey
ALTER TABLE "learning_update_requests" ADD CONSTRAINT "learning_update_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_update_runs" ADD CONSTRAINT "learning_update_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

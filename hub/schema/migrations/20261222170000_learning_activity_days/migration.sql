-- CreateTable
CREATE TABLE "learning_activity_days" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "last_requested_by_id" UUID,
    "date" DATE NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "comments_analyzed" INTEGER NOT NULL DEFAULT 0,
    "comments_tagged" INTEGER NOT NULL DEFAULT 0,
    "suggestions" INTEGER NOT NULL DEFAULT 0,
    "last_run_state" "LearningRunState" NOT NULL,
    "last_scheduled" BOOLEAN NOT NULL,
    "last_started_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_activity_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_activity_days_last_requested_by_id_idx" ON "learning_activity_days"("last_requested_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_activity_days_repository_id_date_key" ON "learning_activity_days"("repository_id", "date");

-- AddForeignKey
ALTER TABLE "learning_activity_days" ADD CONSTRAINT "learning_activity_days_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_activity_days" ADD CONSTRAINT "learning_activity_days_last_requested_by_id_fkey" FOREIGN KEY ("last_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

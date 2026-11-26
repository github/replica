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

-- Backfill: runs finished before this table existed. Runs are deleted after 90 days, so
-- their days would otherwise show no activity. Same UTC day rule as new runs.
INSERT INTO "learning_activity_days" (
    "id", "repository_id", "date", "runs", "comments_analyzed", "comments_tagged",
    "suggestions", "last_run_state", "last_scheduled", "last_started_at",
    "last_requested_by_id"
)
SELECT
    gen_random_uuid(),
    "repository_id",
    "day",
    COUNT(*)::INTEGER,
    SUM("comments_considered")::INTEGER,
    SUM("comments_labeled")::INTEGER,
    SUM("suggestions")::INTEGER,
    (ARRAY_AGG("state" ORDER BY "started", "number"))[COUNT(*)],
    (ARRAY_AGG("scheduled" ORDER BY "started", "number"))[COUNT(*)],
    MAX("started"),
    (ARRAY_AGG("requested_by_id" ORDER BY "started", "number"))[COUNT(*)]
FROM (
    SELECT *, COALESCE("started_at", "created_at") AS "started",
        (COALESCE("started_at", "created_at") AT TIME ZONE 'UTC')::DATE AS "day"
    FROM "learning_runs"
    WHERE "state" IN ('SUCCEEDED', 'FAILED')
) AS "finished"
GROUP BY "repository_id", "day";

CREATE TYPE "AnalyticsEventName" AS ENUM (
    'prototype_registered', 'prototype_first_published', 'build_published',
    'review_comment_created', 'review_reply_added', 'review_thread_resolved', 'review_thread_reopened'
);
CREATE TYPE "AnalyticsProvider" AS ENUM ('segment', 'mixpanel', 'custom');
CREATE TYPE "AnalyticsDeliveryState" AS ENUM ('pending', 'delivering', 'retryable', 'succeeded', 'failed', 'canceled');

ALTER TABLE "prototypes" ADD COLUMN "first_published_at" TIMESTAMPTZ(3);

-- Existing successful Builds have already published; do not make up events for them.
UPDATE "prototypes" AS prototype
SET "first_published_at" = published."first_published_at"
FROM (
    SELECT "prototype_id", MIN(COALESCE("finished_at", "updated_at", "created_at")) AS "first_published_at"
    FROM "builds"
    WHERE "state" = 'successful'
    GROUP BY "prototype_id"
) AS published
WHERE prototype."id" = published."prototype_id";

CREATE TABLE "analytics_repository_states" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_repository_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_repository_states_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_repository_states_repository_id_key" ON "analytics_repository_states"("repository_id");

CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "build_id" UUID,
    "thread_id" UUID,
    "comment_id" UUID,
    "event_name" "AnalyticsEventName" NOT NULL,
    "source_key" VARCHAR(60) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_events_scoped_fields_check" CHECK (
        ("event_name" = 'prototype_registered' AND "build_id" IS NULL AND "thread_id" IS NULL AND "comment_id" IS NULL)
        OR ("event_name" IN ('prototype_first_published', 'build_published') AND "build_id" IS NOT NULL AND "thread_id" IS NULL AND "comment_id" IS NULL)
        OR ("event_name" IN ('review_comment_created', 'review_reply_added') AND "build_id" IS NOT NULL AND "thread_id" IS NOT NULL AND "comment_id" IS NOT NULL)
        OR ("event_name" IN ('review_thread_resolved', 'review_thread_reopened') AND "build_id" IS NOT NULL AND "thread_id" IS NOT NULL AND "comment_id" IS NULL)
    ),
    CONSTRAINT "analytics_events_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_events_id_repository_id_key" ON "analytics_events"("id", "repository_id");
CREATE UNIQUE INDEX "analytics_events_repository_id_source_key_key" ON "analytics_events"("repository_id", "source_key");
CREATE INDEX "analytics_events_repository_id_occurred_at_id_idx" ON "analytics_events"("repository_id", "occurred_at", "id");
CREATE INDEX "analytics_events_occurred_at_id_idx" ON "analytics_events"("occurred_at", "id");

CREATE TABLE "analytics_destinations" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "provider" "AnalyticsProvider" NOT NULL,
    "destination_key" VARCHAR(128) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "event_types" "AnalyticsEventName"[] NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "configuration_ciphertext" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_destinations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_destinations_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_destinations_id_repository_id_key" ON "analytics_destinations"("id", "repository_id");
CREATE UNIQUE INDEX "analytics_destinations_repository_id_destination_key_key" ON "analytics_destinations"("repository_id", "destination_key");

CREATE TABLE "analytics_deliveries" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "lease_id" UUID,
    "state" "AnalyticsDeliveryState" NOT NULL DEFAULT 'pending',
    "destination_revision" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(40),
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "enqueue_claim_expires_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_deliveries_attempts_check" CHECK ("attempts" BETWEEN 0 AND 8),
    CONSTRAINT "analytics_deliveries_destination_id_repository_id_fkey" FOREIGN KEY ("destination_id", "repository_id") REFERENCES "analytics_destinations"("id", "repository_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "analytics_deliveries_event_id_repository_id_fkey" FOREIGN KEY ("event_id", "repository_id") REFERENCES "analytics_events"("id", "repository_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_deliveries_event_id_destination_id_key" ON "analytics_deliveries"("event_id", "destination_id");
CREATE INDEX "analytics_deliveries_destination_id_state_idx" ON "analytics_deliveries"("destination_id", "state");
CREATE INDEX "analytics_deliveries_state_due_at_id_idx" ON "analytics_deliveries"("state", "due_at", "id");

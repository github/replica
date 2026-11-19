-- CreateEnum
CREATE TYPE "GitHubWebhookRedeliveryState" AS ENUM ('pending', 'requesting', 'waiting', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "github_webhook_recovery_checkpoints" (
    "app_id" VARCHAR(100) NOT NULL,
    "lease_id" UUID,
    "cursor" VARCHAR(2048),
    "lease_expires_at" TIMESTAMPTZ(3),
    "scan_started_at" TIMESTAMPTZ(3),
    "last_completed_scan_started_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_webhook_recovery_checkpoints_pkey" PRIMARY KEY ("app_id")
);

-- CreateTable
CREATE TABLE "github_webhook_redeliveries" (
    "id" UUID NOT NULL,
    "github_delivery_id" BIGINT NOT NULL,
    "event" VARCHAR(50) NOT NULL,
    "state" "GitHubWebhookRedeliveryState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(50),
    "retry_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_webhook_redeliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_webhook_redeliveries_state_retry_at_idx" ON "github_webhook_redeliveries"("state", "retry_at");

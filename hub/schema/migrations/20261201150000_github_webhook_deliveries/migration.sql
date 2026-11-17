CREATE TABLE "github_webhook_deliveries" (
    "id" UUID NOT NULL,
    "event" VARCHAR(50) NOT NULL,
    "payload_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- Preserve existing checkpoints while giving each row a UUID primary key.
ALTER TABLE "github_webhook_recovery_checkpoints"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "github_webhook_recovery_checkpoints"
  ALTER COLUMN "id" DROP DEFAULT,
  DROP CONSTRAINT "github_webhook_recovery_checkpoints_pkey",
  ADD CONSTRAINT "github_webhook_recovery_checkpoints_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "github_webhook_recovery_checkpoints_app_id_key"
  ON "github_webhook_recovery_checkpoints"("app_id");

-- A selection watermark orders runs created in the same second.
ALTER TABLE "prototypes" ADD COLUMN "current_build_run_id" BIGINT;

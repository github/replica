CREATE TYPE "PrivatePreviewState" AS ENUM ('pending', 'ready');

ALTER TABLE "builds" ADD COLUMN "private_preview_state" "PrivatePreviewState";

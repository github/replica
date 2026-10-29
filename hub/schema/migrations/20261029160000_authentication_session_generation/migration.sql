-- AlterTable
ALTER TABLE "identity_store_states" ADD COLUMN "session_generation" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "authorization_attempts" ADD COLUMN "session_generation" INTEGER NOT NULL DEFAULT 0;

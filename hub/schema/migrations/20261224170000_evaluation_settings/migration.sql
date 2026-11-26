-- CreateTable
CREATE TABLE "agent_screenshots" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "grant_id" VARCHAR(255) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "monthly_budget_credits" DECIMAL(20,9) NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_evaluation_settings" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "screenshots_changed_by_membership_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "screenshot_grant_id" VARCHAR(255),
    "screenshots_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_evaluation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_screenshots_storage_key_key" ON "agent_screenshots"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_screenshots_repository_id_grant_id_sha256_key" ON "agent_screenshots"("repository_id", "grant_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_settings_key_key" ON "evaluation_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "repository_evaluation_settings_repository_id_key" ON "repository_evaluation_settings"("repository_id");

-- CreateIndex
CREATE INDEX "repository_evaluation_settings_screenshots_changed_by_membe_idx" ON "repository_evaluation_settings"("screenshots_changed_by_membership_id");

-- AddForeignKey
ALTER TABLE "agent_screenshots" ADD CONSTRAINT "agent_screenshots_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_evaluation_settings" ADD CONSTRAINT "repository_evaluation_settings_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_evaluation_settings" ADD CONSTRAINT "repository_evaluation_settings_screenshots_changed_by_memb_fkey" FOREIGN KEY ("screenshots_changed_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

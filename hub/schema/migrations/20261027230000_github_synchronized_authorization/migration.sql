-- CreateTable
CREATE TABLE "github_authorization_policies" (
    "id" UUID NOT NULL,
    "last_known_good_seconds" INTEGER NOT NULL DEFAULT 86400,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_authorization_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "github_authorization_policies_last_known_good_seconds" CHECK (
      "last_known_good_seconds" BETWEEN 0 AND 604800
    )
);

INSERT INTO "github_authorization_policies" ("id")
VALUES ('00000000-0000-0000-0000-000000000001');

ALTER TABLE "installation_memberships"
DROP CONSTRAINT "installation_memberships_source";

ALTER TABLE "installation_memberships"
ADD CONSTRAINT "installation_memberships_source"
CHECK ("source" IN (
  'bootstrap',
  'invitation',
  'legacy-synchronized',
  'manual',
  'recovery',
  'synchronized'
));

UPDATE "installation_memberships"
SET "source" = 'legacy-synchronized'
WHERE "source" = 'synchronized';

-- CreateTable
CREATE TABLE "github_repository_sources" (
    "id" UUID NOT NULL,
    "github_repository_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "admission_enabled" BOOLEAN NOT NULL DEFAULT false,
    "synchronization_generation" INTEGER NOT NULL DEFAULT 0,
    "synchronization_status" TEXT NOT NULL DEFAULT 'dirty',
    "synchronization_error" TEXT,
    "removed_at" TIMESTAMPTZ(3),
    "dirty_at" TIMESTAMPTZ(3),
    "last_attempted_at" TIMESTAMPTZ(3),
    "last_confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_repository_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "github_repository_sources_status" CHECK ("status" IN ('active', 'removed')),
    CONSTRAINT "github_repository_sources_synchronization_generation" CHECK (
      "synchronization_generation" >= 0
    ),
    CONSTRAINT "github_repository_sources_synchronization_status" CHECK (
      "synchronization_status" IN ('dirty', 'current', 'failed', 'removed')
    )
);

-- CreateTable
CREATE TABLE "github_synchronized_access" (
    "id" UUID NOT NULL,
    "repository_source_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "raw_permission" TEXT NOT NULL,
    "mapped_prototype_role" "PrototypeRole",
    "admission_eligible" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'github_app_installation',
    "synchronization_status" TEXT NOT NULL DEFAULT 'current',
    "last_confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_synchronized_access_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "github_synchronized_access_raw_permission" CHECK (
      "raw_permission" IN ('admin', 'maintain', 'write', 'triage', 'read', 'none')
    ),
    CONSTRAINT "github_synchronized_access_status" CHECK ("status" IN ('active', 'removed')),
    CONSTRAINT "github_synchronized_access_synchronization_status" CHECK (
      "synchronization_status" IN ('current', 'dirty', 'failed', 'removed')
    )
);

-- CreateTable
CREATE TABLE "github_webhook_deliveries" (
    "id" UUID NOT NULL,
    "repository_source_id" UUID,
    "delivery_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "prototypes"
ADD COLUMN "authorization_mode" TEXT NOT NULL DEFAULT 'hub-managed',
ADD COLUMN "source_repository_id" UUID,
ADD CONSTRAINT "prototypes_authorization_mode" CHECK (
  "authorization_mode" IN ('hub-managed', 'github-synchronized')
);

ALTER TABLE "security_audits"
ADD COLUMN "github_repository_source_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "github_repository_sources_github_repository_id_key" ON "github_repository_sources"("github_repository_id");
CREATE INDEX "github_repository_sources_installation_id_status_idx" ON "github_repository_sources"("installation_id", "status");
CREATE UNIQUE INDEX "github_synchronized_access_repository_source_id_user_id_key" ON "github_synchronized_access"("repository_source_id", "user_id");
CREATE INDEX "github_synchronized_access_user_id_status_idx" ON "github_synchronized_access"("user_id", "status");
CREATE UNIQUE INDEX "github_webhook_deliveries_delivery_id_key" ON "github_webhook_deliveries"("delivery_id");
CREATE INDEX "github_webhook_deliveries_installation_id_created_at_idx" ON "github_webhook_deliveries"("installation_id", "created_at");
CREATE INDEX "prototypes_source_repository_id_idx" ON "prototypes"("source_repository_id");
CREATE INDEX "security_audits_github_repository_source_id_idx" ON "security_audits"("github_repository_source_id");

-- AddForeignKey
ALTER TABLE "github_synchronized_access" ADD CONSTRAINT "github_synchronized_access_repository_source_id_fkey" FOREIGN KEY ("repository_source_id") REFERENCES "github_repository_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_synchronized_access" ADD CONSTRAINT "github_synchronized_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_repository_source_id_fkey" FOREIGN KEY ("repository_source_id") REFERENCES "github_repository_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_source_repository_id_fkey" FOREIGN KEY ("source_repository_id") REFERENCES "github_repository_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_audits" ADD CONSTRAINT "security_audits_github_repository_source_id_fkey" FOREIGN KEY ("github_repository_source_id") REFERENCES "github_repository_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

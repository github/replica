-- CreateEnum
CREATE TYPE "PrototypeRole" AS ENUM ('viewer', 'commenter', 'editor', 'administrator');

-- CreateEnum
CREATE TYPE "AccessEffect" AS ENUM ('allow', 'deny');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prototypes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prototypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prototype_versions" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prototype_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_access_grants" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effect" "AccessEffect" NOT NULL,
    "role" "PrototypeRole",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_access_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_access_grants_effect_role" CHECK (
      ("effect" = 'deny' AND "role" IS NULL) OR
      ("effect" = 'allow' AND "role" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "prototype_access_grants" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effect" "AccessEffect" NOT NULL,
    "role" "PrototypeRole",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prototype_access_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prototype_access_grants_effect_role" CHECK (
      ("effect" = 'deny' AND "role" IS NULL) OR
      ("effect" = 'allow' AND "role" IS NOT NULL)
    )
);

-- AlterTable
ALTER TABLE "security_audits"
ADD COLUMN "workspace_id" UUID,
ADD COLUMN "prototype_id" UUID,
ADD COLUMN "prototype_version_id" UUID,
ADD COLUMN "target_user_id" UUID;

-- CreateIndex
CREATE INDEX "workspaces_created_by_user_id_idx" ON "workspaces"("created_by_user_id");
CREATE INDEX "prototypes_workspace_id_idx" ON "prototypes"("workspace_id");
CREATE INDEX "prototypes_created_by_user_id_idx" ON "prototypes"("created_by_user_id");
CREATE UNIQUE INDEX "prototype_versions_prototype_id_sequence_key" ON "prototype_versions"("prototype_id", "sequence");
CREATE INDEX "prototype_versions_created_by_user_id_idx" ON "prototype_versions"("created_by_user_id");
CREATE UNIQUE INDEX "workspace_access_grants_workspace_id_user_id_key" ON "workspace_access_grants"("workspace_id", "user_id");
CREATE INDEX "workspace_access_grants_user_id_idx" ON "workspace_access_grants"("user_id");
CREATE UNIQUE INDEX "prototype_access_grants_prototype_id_user_id_key" ON "prototype_access_grants"("prototype_id", "user_id");
CREATE INDEX "prototype_access_grants_user_id_idx" ON "prototype_access_grants"("user_id");
CREATE INDEX "security_audits_workspace_id_idx" ON "security_audits"("workspace_id");
CREATE INDEX "security_audits_prototype_id_idx" ON "security_audits"("prototype_id");
CREATE INDEX "security_audits_prototype_version_id_idx" ON "security_audits"("prototype_version_id");
CREATE INDEX "security_audits_target_user_id_idx" ON "security_audits"("target_user_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototype_versions" ADD CONSTRAINT "prototype_versions_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototype_versions" ADD CONSTRAINT "prototype_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_access_grants" ADD CONSTRAINT "workspace_access_grants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_access_grants" ADD CONSTRAINT "workspace_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototype_access_grants" ADD CONSTRAINT "prototype_access_grants_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prototype_access_grants" ADD CONSTRAINT "prototype_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

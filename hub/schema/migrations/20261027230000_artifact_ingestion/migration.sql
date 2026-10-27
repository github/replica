-- CreateTable
CREATE TABLE "workload_publishers" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "actions" TEXT[] NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workload_publishers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workload_publishers_actions" CHECK (
        cardinality("actions") BETWEEN 1 AND 2 AND
        "actions" <@ ARRAY['publish', 'read-status']::TEXT[] AND
        "actions" <> ARRAY['publish', 'publish']::TEXT[] AND
        "actions" <> ARRAY['read-status', 'read-status']::TEXT[]
    )
);

-- CreateTable
CREATE TABLE "workload_credentials" (
    "id" UUID NOT NULL,
    "workload_publisher_id" UUID NOT NULL,
    "token_digest" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workload_credentials_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "prototype_versions"
ALTER COLUMN "created_by_user_id" DROP NOT NULL,
ADD COLUMN "workload_publisher_id" UUID,
ADD COLUMN "artifact_format" TEXT,
ADD COLUMN "artifact_version" TEXT,
ADD COLUMN "content_digest" TEXT,
ADD COLUMN "size_bytes" INTEGER,
ADD COLUMN "built_at" TIMESTAMPTZ(3),
ADD COLUMN "provenance_provider" TEXT,
ADD COLUMN "provenance_source_url" TEXT,
ADD COLUMN "provenance_revision" TEXT,
ADD COLUMN "provenance_ref" TEXT,
ADD COLUMN "provenance_pipeline" TEXT,
ADD COLUMN "provenance_run_id" TEXT,
ADD COLUMN "storage_key" TEXT,
ADD CONSTRAINT "prototype_versions_single_creator" CHECK (
    ("created_by_user_id" IS NOT NULL) <> ("workload_publisher_id" IS NOT NULL)
),
ADD CONSTRAINT "prototype_versions_published_artifact" CHECK (
    "workload_publisher_id" IS NULL OR (
        "artifact_format" IS NOT NULL AND
        "artifact_version" IS NOT NULL AND
        "content_digest" IS NOT NULL AND
        "size_bytes" IS NOT NULL AND
        "built_at" IS NOT NULL AND
        "provenance_provider" IS NOT NULL AND
        "storage_key" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "artifact_publications" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "workload_publisher_id" UUID NOT NULL,
    "prototype_version_id" UUID NOT NULL,
    "idempotency_key_digest" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prototype_channels" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "prototype_version_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prototype_channels_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "security_audits" ADD COLUMN "workload_publisher_id" UUID;

-- CreateIndex
CREATE INDEX "workload_publishers_prototype_id_idx" ON "workload_publishers"("prototype_id");
CREATE UNIQUE INDEX "workload_credentials_token_digest_key" ON "workload_credentials"("token_digest");
CREATE INDEX "workload_credentials_workload_publisher_id_idx" ON "workload_credentials"("workload_publisher_id");
CREATE INDEX "prototype_versions_workload_publisher_id_idx" ON "prototype_versions"("workload_publisher_id");
CREATE UNIQUE INDEX "prototype_versions_prototype_id_content_digest_key" ON "prototype_versions"("prototype_id", "content_digest");
CREATE UNIQUE INDEX "artifact_publications_prototype_version_id_key" ON "artifact_publications"("prototype_version_id");
CREATE UNIQUE INDEX "artifact_publications_workload_publisher_id_idempotency_key_digest_key" ON "artifact_publications"("workload_publisher_id", "idempotency_key_digest");
CREATE INDEX "artifact_publications_prototype_id_idx" ON "artifact_publications"("prototype_id");
CREATE UNIQUE INDEX "prototype_channels_prototype_id_name_key" ON "prototype_channels"("prototype_id", "name");
CREATE INDEX "prototype_channels_prototype_version_id_idx" ON "prototype_channels"("prototype_version_id");
CREATE INDEX "security_audits_workload_publisher_id_idx" ON "security_audits"("workload_publisher_id");

-- AddForeignKey
ALTER TABLE "workload_publishers" ADD CONSTRAINT "workload_publishers_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workload_credentials" ADD CONSTRAINT "workload_credentials_workload_publisher_id_fkey" FOREIGN KEY ("workload_publisher_id") REFERENCES "workload_publishers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototype_versions" ADD CONSTRAINT "prototype_versions_workload_publisher_id_fkey" FOREIGN KEY ("workload_publisher_id") REFERENCES "workload_publishers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifact_publications" ADD CONSTRAINT "artifact_publications_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifact_publications" ADD CONSTRAINT "artifact_publications_workload_publisher_id_fkey" FOREIGN KEY ("workload_publisher_id") REFERENCES "workload_publishers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifact_publications" ADD CONSTRAINT "artifact_publications_prototype_version_id_fkey" FOREIGN KEY ("prototype_version_id") REFERENCES "prototype_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototype_channels" ADD CONSTRAINT "prototype_channels_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prototype_channels" ADD CONSTRAINT "prototype_channels_prototype_version_id_fkey" FOREIGN KEY ("prototype_version_id") REFERENCES "prototype_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable prototype versions may be inserted and read, but never rewritten or deleted.
CREATE FUNCTION reject_prototype_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prototype versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prototype_versions_immutable
BEFORE UPDATE OR DELETE ON "prototype_versions"
FOR EACH ROW EXECUTE FUNCTION reject_prototype_version_mutation();

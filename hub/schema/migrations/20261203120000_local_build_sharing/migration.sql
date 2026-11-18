CREATE TABLE "sharing_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "public_sharing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sharing_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sharing_settings_revision_check" CHECK ("revision" >= 0)
);

CREATE UNIQUE INDEX "sharing_settings_key_key"
ON "sharing_settings"("key");

CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "created_by_login" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "share_links_label_check"
      CHECK (length(btrim("label")) > 0 AND octet_length("label") <= 100),
    CONSTRAINT "share_links_expiration_check"
      CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "share_links_public_id_key"
ON "share_links"("public_id");

CREATE INDEX "share_links_prototype_id_created_at_id_idx"
ON "share_links"("prototype_id", "created_at", "id");

CREATE INDEX "share_links_build_id_idx"
ON "share_links"("build_id");

CREATE INDEX "share_links_created_by_id_idx"
ON "share_links"("created_by_id");

ALTER TABLE "share_links"
ADD CONSTRAINT "share_links_prototype_id_fkey"
FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "share_links"
ADD CONSTRAINT "share_links_build_id_prototype_id_fkey"
FOREIGN KEY ("build_id", "prototype_id") REFERENCES "builds"("id", "prototype_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "share_links"
ADD CONSTRAINT "share_links_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

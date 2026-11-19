-- Keep the extension's numeric interface independent of Hub's browser UUIDs.
ALTER TABLE "users" ADD COLUMN "canvas_id" SERIAL NOT NULL;
ALTER TABLE "repositories" ADD COLUMN "canvas_id" SERIAL NOT NULL;
ALTER TABLE "prototypes" ADD COLUMN "canvas_id" SERIAL NOT NULL;
CREATE UNIQUE INDEX "users_canvas_id_key" ON "users"("canvas_id");
CREATE UNIQUE INDEX "repositories_canvas_id_key" ON "repositories"("canvas_id");
CREATE UNIQUE INDEX "prototypes_canvas_id_key" ON "prototypes"("canvas_id");

CREATE TABLE "canvas_pairings" (
  "id" UUID PRIMARY KEY,
  "repository_id" UUID NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "session_id" UUID REFERENCES "hub_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "user_code" VARCHAR(10) NOT NULL,
  "device_digest" VARCHAR(64) NOT NULL,
  "refresh_digest" VARCHAR(64),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "approved_at" TIMESTAMPTZ(3),
  "consumed_at" TIMESTAMPTZ(3),
  CONSTRAINT "canvas_pairings_consumption" CHECK ("consumed_at" IS NULL OR "approved_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "canvas_pairings_user_code_key" ON "canvas_pairings"("user_code");
CREATE UNIQUE INDEX "canvas_pairings_device_digest_key" ON "canvas_pairings"("device_digest");
CREATE UNIQUE INDEX "canvas_pairings_refresh_digest_key" ON "canvas_pairings"("refresh_digest");
CREATE INDEX "canvas_pairings_expires_at_idx" ON "canvas_pairings"("expires_at");

CREATE TABLE "canvas_grants" (
  "id" SERIAL PRIMARY KEY,
  "repository_id" UUID NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "membership_id" UUID NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "external_identity_id" UUID NOT NULL REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "provider_revision_id" UUID NOT NULL REFERENCES "authentication_provider_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revocation_revision" INTEGER NOT NULL,
  "token_digest" VARCHAR(64) NOT NULL,
  "refresh_digest" VARCHAR(64),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_active_at" TIMESTAMPTZ(3),
  "inactive_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canvas_grants_renewable" CHECK (
    ("refresh_digest" IS NULL AND "last_active_at" IS NULL AND "inactive_at" IS NULL)
    OR ("refresh_digest" IS NOT NULL AND "last_active_at" IS NOT NULL AND "inactive_at" > "last_active_at"
        AND "last_active_at" IS NOT NULL AND "inactive_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "canvas_grants_token_digest_key" ON "canvas_grants"("token_digest");
CREATE UNIQUE INDEX "canvas_grants_refresh_digest_key" ON "canvas_grants"("refresh_digest");
CREATE INDEX "canvas_grants_membership_id_external_identity_id_created_at_idx"
  ON "canvas_grants"("membership_id", "external_identity_id", "created_at");
CREATE INDEX "canvas_grants_repository_id_idx" ON "canvas_grants"("repository_id");

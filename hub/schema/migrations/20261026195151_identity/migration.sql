-- CreateTable
CREATE TABLE "authentication_providers" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authentication_provider_revisions" (
    "id" UUID NOT NULL,
    "authentication_provider_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "issuer" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_provider_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_store_states" (
    "id" UUID NOT NULL,
    "session_generation" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_store_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_integration_credentials" (
    "id" UUID NOT NULL,
    "encrypted_credentials" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_integration_credentials_pkey" PRIMARY KEY ("id")
);

-- SeedData
INSERT INTO "github_integration_credentials" ("id") VALUES ('00000000-0000-4000-8000-000000000001');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "username" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_identity_id" UUID NOT NULL,
    "authentication_provider_revision_id" UUID NOT NULL,
    "token_digest" TEXT NOT NULL,
    "signed_in_at" TIMESTAMPTZ(3) NOT NULL,
    "fresh_authorized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_attempts" (
    "id" UUID NOT NULL,
    "authentication_provider_revision_id" UUID NOT NULL,
    "originating_session_id" UUID,
    "state_digest" TEXT NOT NULL,
    "browser_digest" TEXT NOT NULL,
    "pkce_verifier" TEXT NOT NULL,
    "nonce" TEXT,
    "purpose" TEXT NOT NULL,
    "session_generation" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_audits" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "session_id" UUID,
    "authentication_provider_revision_id" UUID,
    "event" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authentication_providers_key_key" ON "authentication_providers"("key");

-- CreateIndex
CREATE INDEX "authentication_provider_revisions_issuer_idx" ON "authentication_provider_revisions"("issuer");

-- CreateIndex
CREATE UNIQUE INDEX "authentication_provider_revisions_authentication_provider_i_key" ON "authentication_provider_revisions"("authentication_provider_id", "revision");

-- CreateIndex
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_provider_issuer_subject_key" ON "external_identities"("provider", "issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "installation_memberships_user_id_key" ON "installation_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_external_identity_id_idx" ON "sessions"("external_identity_id");

-- CreateIndex
CREATE INDEX "sessions_authentication_provider_revision_id_idx" ON "sessions"("authentication_provider_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_attempts_state_digest_key" ON "authorization_attempts"("state_digest");

-- CreateIndex
CREATE INDEX "authorization_attempts_expires_at_idx" ON "authorization_attempts"("expires_at");

-- CreateIndex
CREATE INDEX "authorization_attempts_authentication_provider_revision_id_idx" ON "authorization_attempts"("authentication_provider_revision_id");

-- CreateIndex
CREATE INDEX "authorization_attempts_originating_session_id_idx" ON "authorization_attempts"("originating_session_id");

-- CreateIndex
CREATE INDEX "security_audits_created_at_idx" ON "security_audits"("created_at");

-- AddForeignKey
ALTER TABLE "authentication_provider_revisions" ADD CONSTRAINT "authentication_provider_revisions_authentication_provider__fkey" FOREIGN KEY ("authentication_provider_id") REFERENCES "authentication_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_memberships" ADD CONSTRAINT "installation_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_authentication_provider_revision_id_fkey" FOREIGN KEY ("authentication_provider_revision_id") REFERENCES "authentication_provider_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_attempts" ADD CONSTRAINT "authorization_attempts_authentication_provider_revision_id_fkey" FOREIGN KEY ("authentication_provider_revision_id") REFERENCES "authentication_provider_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_attempts" ADD CONSTRAINT "authorization_attempts_originating_session_id_fkey" FOREIGN KEY ("originating_session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

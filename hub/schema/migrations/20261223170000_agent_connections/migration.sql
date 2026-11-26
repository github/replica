-- CreateTable
CREATE TABLE "agent_authorizations" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "session_id" UUID,
    "redirect_uri" VARCHAR(2048) NOT NULL,
    "code_challenge" VARCHAR(128) NOT NULL,
    "state" VARCHAR(1024),
    "code_digest" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_clients" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "redirect_uris" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_connections" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "external_identity_id" UUID NOT NULL,
    "provider_revision_id" UUID NOT NULL,
    "revocation_revision" INTEGER NOT NULL,
    "token_digest" VARCHAR(64) NOT NULL,
    "refresh_digest" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "inactive_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_authorizations_code_digest_key" ON "agent_authorizations"("code_digest");

-- CreateIndex
CREATE INDEX "agent_authorizations_client_id_idx" ON "agent_authorizations"("client_id");

-- CreateIndex
CREATE INDEX "agent_authorizations_session_id_idx" ON "agent_authorizations"("session_id");

-- CreateIndex
CREATE INDEX "agent_authorizations_expires_at_idx" ON "agent_authorizations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_connections_token_digest_key" ON "agent_connections"("token_digest");

-- CreateIndex
CREATE UNIQUE INDEX "agent_connections_refresh_digest_key" ON "agent_connections"("refresh_digest");

-- CreateIndex
CREATE INDEX "agent_connections_client_id_idx" ON "agent_connections"("client_id");

-- CreateIndex
CREATE INDEX "agent_connections_external_identity_id_idx" ON "agent_connections"("external_identity_id");

-- CreateIndex
CREATE INDEX "agent_connections_provider_revision_id_idx" ON "agent_connections"("provider_revision_id");

-- CreateIndex
CREATE INDEX "agent_connections_membership_id_external_identity_id_create_idx" ON "agent_connections"("membership_id", "external_identity_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "agent_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_authorizations" ADD CONSTRAINT "agent_authorizations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "hub_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "agent_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_provider_revision_id_fkey" FOREIGN KEY ("provider_revision_id") REFERENCES "authentication_provider_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

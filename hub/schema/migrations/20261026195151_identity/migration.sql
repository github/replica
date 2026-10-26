-- CreateTable
CREATE TABLE "identity_states" (
    "id" UUID NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "encrypted_credentials" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_attempts" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "state_digest" TEXT NOT NULL,
    "browser_digest" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "credential_revision" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_audits" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "session_id" UUID,
    "event" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_digest" TEXT NOT NULL,
    "signed_in_at" TIMESTAMPTZ(3) NOT NULL,
    "fresh_authorized_at" TIMESTAMPTZ(3),
    "credential_revision" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "provider_id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "administrator" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_attempts_state_digest_key" ON "oauth_attempts"("state_digest");

-- CreateIndex
CREATE INDEX "oauth_attempts_expires_at_idx" ON "oauth_attempts"("expires_at");

-- CreateIndex
CREATE INDEX "security_audits_created_at_idx" ON "security_audits"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_provider_id_key" ON "users"("provider", "provider_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

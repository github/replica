ALTER TYPE "AuthorizationAttemptPurpose" ADD VALUE 'REPOSITORY_ANALYTICS';

CREATE TABLE "analytics_destination_authorizations" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "hub_session_id" UUID NOT NULL,
    "external_identity_id" UUID NOT NULL,
    "mutation_ciphertext" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_destination_authorizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_destination_authorizations_id_fkey" FOREIGN KEY ("id") REFERENCES "authorization_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "analytics_destination_authorizations_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "analytics_destination_authorizations_hub_session_id_fkey" FOREIGN KEY ("hub_session_id") REFERENCES "hub_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_destination_authorizations_hub_session_id_key" ON "analytics_destination_authorizations"("hub_session_id");
CREATE INDEX "analytics_destination_authorizations_repository_id_idx" ON "analytics_destination_authorizations"("repository_id");

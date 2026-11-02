CREATE TYPE "AuthorizationAttemptPurpose" AS ENUM ('SIGN_IN', 'ADMIN_ENROLLMENT');
CREATE TYPE "MembershipLifecycle" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "MembershipRole" AS ENUM ('ADMINISTRATOR', 'MEMBER');
CREATE TYPE "MembershipAssignmentSource" AS ENUM ('BOOTSTRAP', 'PROVIDER');
CREATE TYPE "MembershipAssignmentLifecycle" AS ENUM ('ACTIVE', 'REVOKED');

ALTER TABLE "authorization_attempts"
ADD COLUMN "purpose" "AuthorizationAttemptPurpose" NOT NULL DEFAULT 'SIGN_IN';

ALTER TABLE "authorization_attempts"
ALTER COLUMN "purpose" DROP DEFAULT;

CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lifecycle" "MembershipLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership_assignments" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "external_identity_id" UUID,
    "provider_id" UUID,
    "source" "MembershipAssignmentSource" NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "lifecycle" "MembershipAssignmentLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_assignments_owner" CHECK (
        ("source" = 'BOOTSTRAP' AND "external_identity_id" IS NOT NULL AND "provider_id" IS NULL)
        OR
        ("source" = 'PROVIDER' AND "external_identity_id" IS NULL AND "provider_id" IS NOT NULL)
    )
);

CREATE TABLE "session_revocation_states" (
    "id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_revocation_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_revocation_states_revision" CHECK ("revision" >= 0)
);

CREATE TABLE "hub_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "revocation_revision" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hub_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hub_sessions_digest" CHECK ("digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "hub_sessions_expiry" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "hub_sessions_ended" CHECK ("ended_at" IS NULL OR "ended_at" >= "created_at"),
    CONSTRAINT "hub_sessions_revocation_revision" CHECK ("revocation_revision" >= 0)
);

CREATE TABLE "authentication_rate_limits" (
    "id" UUID NOT NULL,
    "operation" VARCHAR(50) NOT NULL,
    "subject_digest" VARCHAR(64) NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "authentication_rate_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authentication_rate_limits_digest" CHECK ("subject_digest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "authentication_rate_limits_count" CHECK ("count" > 0),
    CONSTRAINT "authentication_rate_limits_expiry" CHECK ("expires_at" > "window_started_at")
);

CREATE UNIQUE INDEX "memberships_user_id_key" ON "memberships"("user_id");
CREATE INDEX "memberships_lifecycle_idx" ON "memberships"("lifecycle");
CREATE UNIQUE INDEX "membership_assignments_membership_id_source_role_key"
ON "membership_assignments"("membership_id", "source", "role");
CREATE INDEX "membership_assignments_external_identity_id_idx"
ON "membership_assignments"("external_identity_id");
CREATE INDEX "membership_assignments_provider_id_idx"
ON "membership_assignments"("provider_id");
CREATE UNIQUE INDEX "session_revocation_states_key_key"
ON "session_revocation_states"("key");
CREATE UNIQUE INDEX "hub_sessions_digest_key" ON "hub_sessions"("digest");
CREATE INDEX "hub_sessions_membership_id_expires_at_idx"
ON "hub_sessions"("membership_id", "expires_at");
CREATE INDEX "hub_sessions_user_id_idx" ON "hub_sessions"("user_id");
CREATE UNIQUE INDEX "authentication_rate_limits_operation_subject_digest_key"
ON "authentication_rate_limits"("operation", "subject_digest");
CREATE INDEX "authentication_rate_limits_expires_at_idx"
ON "authentication_rate_limits"("expires_at");

ALTER TABLE "memberships"
ADD CONSTRAINT "memberships_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_external_identity_id_fkey"
FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_provider_id_fkey"
FOREIGN KEY ("provider_id") REFERENCES "authentication_providers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hub_sessions"
ADD CONSTRAINT "hub_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hub_sessions"
ADD CONSTRAINT "hub_sessions_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "session_revocation_states" (
    "id", "key", "revision", "created_at", "updated_at"
) VALUES (
    gen_random_uuid(), 'global', 0, clock_timestamp(), clock_timestamp()
);

CREATE FUNCTION protect_authorization_attempt_purpose()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."purpose" <> OLD."purpose" THEN
        RAISE EXCEPTION 'Authorization attempt purpose is immutable.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "authorization_attempts_purpose_protected"
BEFORE UPDATE ON "authorization_attempts"
FOR EACH ROW EXECUTE FUNCTION protect_authorization_attempt_purpose();

CREATE FUNCTION protect_hub_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Hub session history cannot be deleted.';
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."user_id" <> OLD."user_id"
       OR NEW."membership_id" <> OLD."membership_id"
       OR NEW."digest" <> OLD."digest"
       OR NEW."revocation_revision" <> OLD."revocation_revision"
       OR NEW."expires_at" <> OLD."expires_at"
       OR NEW."created_at" <> OLD."created_at"
       OR OLD."ended_at" IS NOT NULL
       OR NEW."ended_at" IS NULL THEN
        RAISE EXCEPTION 'Hub session history is immutable except for first termination.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "hub_sessions_protected"
BEFORE UPDATE OR DELETE ON "hub_sessions"
FOR EACH ROW EXECUTE FUNCTION protect_hub_session();

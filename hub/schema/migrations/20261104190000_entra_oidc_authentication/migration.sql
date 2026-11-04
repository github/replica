ALTER TYPE "MembershipAssignmentSource" ADD VALUE 'AUTHENTICATION_PROVIDER';
ALTER TYPE "MembershipAssignmentLifecycle" ADD VALUE 'SUPERSEDED' BEFORE 'REVOKED';

ALTER TABLE "authorization_attempts"
ADD COLUMN "nonce_ciphertext" VARCHAR(500),
ADD COLUMN "requires_fresh_authentication" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "membership_assignments"
ADD COLUMN "provider_revision_id" UUID,
ADD COLUMN "provider_assignment_subject" VARCHAR(100);

DROP INDEX "membership_assignments_membership_id_source_role_key";
DROP INDEX "membership_assignments_external_identity_id_key";

ALTER TABLE "membership_assignments"
DROP CONSTRAINT "membership_assignments_bootstrap_administrator";

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_source_contract" CHECK (
    (
        "source" = 'BOOTSTRAP'
        AND "role" = 'ADMINISTRATOR'
        AND "provider_revision_id" IS NULL
        AND "provider_assignment_subject" IS NULL
    )
    OR
    (
        "source" = 'AUTHENTICATION_PROVIDER'
        AND "provider_revision_id" IS NOT NULL
        AND "provider_assignment_subject" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
);

CREATE UNIQUE INDEX "membership_assignments_active_bootstrap_key"
ON "membership_assignments"("membership_id")
WHERE "source" = 'BOOTSTRAP' AND "lifecycle" = 'ACTIVE';

CREATE UNIQUE INDEX "membership_assignments_active_provider_identity_key"
ON "membership_assignments"("external_identity_id")
WHERE "source" = 'AUTHENTICATION_PROVIDER' AND "lifecycle" = 'ACTIVE';

CREATE INDEX "membership_assignments_provider_revision_id_idx"
ON "membership_assignments"("provider_revision_id");

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_provider_revision_id_fkey"
FOREIGN KEY ("provider_revision_id") REFERENCES "authentication_provider_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_authorization_attempt_purpose()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."purpose" <> OLD."purpose"
       OR NEW."nonce_ciphertext" IS DISTINCT FROM OLD."nonce_ciphertext"
       OR NEW."requires_fresh_authentication" <> OLD."requires_fresh_authentication" THEN
        RAISE EXCEPTION 'Authorization attempt purpose and verification requirements are immutable.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_membership_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    membership_user_id UUID;
    identity_user_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Membership assignment history cannot be deleted.';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT "user_id" INTO membership_user_id
        FROM "memberships"
        WHERE "id" = NEW."membership_id";

        SELECT "user_id" INTO identity_user_id
        FROM "external_identities"
        WHERE "id" = NEW."external_identity_id";

        IF membership_user_id IS NULL
           OR identity_user_id IS NULL
           OR membership_user_id <> identity_user_id THEN
            RAISE EXCEPTION 'Membership assignment owner must belong to the membership user.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."id" <> OLD."id"
       OR NEW."membership_id" <> OLD."membership_id"
       OR NEW."external_identity_id" <> OLD."external_identity_id"
       OR NEW."provider_revision_id" IS DISTINCT FROM OLD."provider_revision_id"
       OR NEW."source" <> OLD."source"
       OR NEW."role" <> OLD."role"
       OR NEW."provider_assignment_subject" IS DISTINCT FROM OLD."provider_assignment_subject"
       OR NEW."created_at" <> OLD."created_at" THEN
        RAISE EXCEPTION 'Membership assignment identity and authority are immutable.';
    END IF;
    IF NEW."lifecycle" = OLD."lifecycle" OR NEW."updated_at" <= OLD."updated_at" THEN
        RAISE EXCEPTION 'Membership assignment lifecycle updates must advance state and updated_at.';
    END IF;
    IF OLD."source" = 'AUTHENTICATION_PROVIDER'
       AND (
           OLD."lifecycle" <> 'ACTIVE'
           OR NEW."lifecycle" NOT IN ('SUPERSEDED', 'REVOKED')
       ) THEN
        RAISE EXCEPTION 'Provider assignment versions may only move from active to terminal.';
    END IF;
    IF OLD."source" = 'BOOTSTRAP'
       AND (
           OLD."lifecycle" NOT IN ('ACTIVE', 'REVOKED')
           OR NEW."lifecycle" NOT IN ('ACTIVE', 'REVOKED')
       ) THEN
        RAISE EXCEPTION 'Bootstrap assignments may only be active or revoked.';
    END IF;
    RETURN NEW;
END;
$$;

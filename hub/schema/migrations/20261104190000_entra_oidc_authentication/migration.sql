ALTER TYPE "MembershipAssignmentSource" ADD VALUE 'AUTHENTICATION_PROVIDER';
ALTER TYPE "MembershipAssignmentLifecycle" ADD VALUE 'SUPERSEDED' BEFORE 'REVOKED';

ALTER TABLE "authorization_attempts"
ADD COLUMN "nonce_ciphertext" VARCHAR(500),
ADD COLUMN "session_revocation_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "authorization_attempts"
ALTER COLUMN "session_revocation_revision" DROP DEFAULT,
ADD CONSTRAINT "authorization_attempts_session_revocation_revision_nonnegative"
CHECK ("session_revocation_revision" >= 0);

CREATE OR REPLACE FUNCTION protect_authorization_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."consumed_at" IS NULL AND OLD."expires_at" > CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION 'Unexpired authorization attempts cannot be deleted.';
        END IF;
        IF OLD."consumed_at" IS NOT NULL
           AND OLD."consumed_at" > CURRENT_TIMESTAMP - interval '10 minutes' THEN
            RAISE EXCEPTION 'Recently consumed authorization attempts cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."provider_revision_id" <> OLD."provider_revision_id"
       OR NEW."state_digest" <> OLD."state_digest"
       OR NEW."browser_binding_digest" <> OLD."browser_binding_digest"
       OR NEW."code_verifier_ciphertext" <> OLD."code_verifier_ciphertext"
       OR NEW."nonce_ciphertext" IS DISTINCT FROM OLD."nonce_ciphertext"
       OR NEW."session_revocation_revision" <> OLD."session_revocation_revision"
       OR NEW."expires_at" <> OLD."expires_at"
       OR NEW."created_at" <> OLD."created_at"
       OR OLD."consumed_at" IS NOT NULL
       OR NEW."consumed_at" IS NULL THEN
        RAISE EXCEPTION 'Authorization attempt history is immutable except for first consumption.';
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE "authentication_providers"
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "last_disabled_revision_id" UUID;

CREATE UNIQUE INDEX "authentication_providers_last_disabled_revision_id_key"
ON "authentication_providers"("last_disabled_revision_id");

ALTER TABLE "authentication_providers"
ADD CONSTRAINT "authentication_providers_last_disabled_revision_id_fkey"
FOREIGN KEY ("last_disabled_revision_id") REFERENCES "authentication_provider_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION track_authentication_provider_disablement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."enabled" AND NOT NEW."enabled" THEN
        NEW."last_disabled_revision_id" := OLD."selected_revision_id";
    ELSIF NEW."last_disabled_revision_id" IS DISTINCT FROM OLD."last_disabled_revision_id" THEN
        RAISE EXCEPTION 'Authentication provider disablement history is database-owned.';
    END IF;

    IF NOT OLD."enabled"
       AND NEW."enabled"
       AND NEW."selected_revision_id" IS NOT DISTINCT FROM OLD."last_disabled_revision_id" THEN
        RAISE EXCEPTION 'Re-enabling an authentication provider requires a new revision.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "authentication_provider_disablement_tracked"
BEFORE UPDATE OF "enabled", "selected_revision_id", "last_disabled_revision_id"
ON "authentication_providers"
FOR EACH ROW EXECUTE FUNCTION track_authentication_provider_disablement();

CREATE OR REPLACE FUNCTION enforce_selected_revision_provider()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_revision UUID;
    last_disabled_revision UUID;
    provider_enabled BOOLEAN;
BEGIN
    SELECT "selected_revision_id", "last_disabled_revision_id", "enabled"
    INTO selected_revision, last_disabled_revision, provider_enabled
    FROM "authentication_providers"
    WHERE "id" = NEW."id";

    IF provider_enabled AND selected_revision IS NULL THEN
        RAISE EXCEPTION 'Enabled authentication provider must have a selected revision.';
    END IF;
    IF NOT provider_enabled AND selected_revision IS NOT NULL THEN
        RAISE EXCEPTION 'Disabled authentication provider cannot have a selected revision.';
    END IF;
    IF selected_revision IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "authentication_provider_revisions"
           WHERE "id" = selected_revision
             AND "provider_id" = NEW."id"
       ) THEN
        RAISE EXCEPTION 'Selected revision must belong to its authentication provider.';
    END IF;
    IF last_disabled_revision IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "authentication_provider_revisions"
           WHERE "id" = last_disabled_revision
             AND "provider_id" = NEW."id"
       ) THEN
        RAISE EXCEPTION 'Last disabled revision must belong to its authentication provider.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER "authentication_provider_selected_revision_owner" ON "authentication_providers";

CREATE CONSTRAINT TRIGGER "authentication_provider_selected_revision_owner"
AFTER INSERT OR UPDATE OF "selected_revision_id", "enabled" ON "authentication_providers"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_selected_revision_provider();

ALTER TABLE "membership_assignments"
ADD COLUMN "provider_revision_id" UUID,
ADD COLUMN "provider_assignment_subject" VARCHAR(100);

CREATE TABLE "provider_evidence_states" (
    "id" UUID NOT NULL,
    "external_identity_id" UUID NOT NULL,
    "last_issued_at" TIMESTAMPTZ(3) NOT NULL,
    "last_role" "MembershipRole",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_evidence_states_pkey" PRIMARY KEY ("id")
);

DROP INDEX "membership_assignments_membership_id_source_role_key";
DROP INDEX "membership_assignments_external_identity_id_key";

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
        AND "provider_assignment_subject" IS NOT NULL
        AND char_length("provider_assignment_subject") BETWEEN 1 AND 100
    )
);

CREATE UNIQUE INDEX "membership_assignments_active_bootstrap_key"
ON "membership_assignments"("membership_id")
WHERE "source" = 'BOOTSTRAP' AND "lifecycle" = 'ACTIVE';

CREATE INDEX "membership_assignments_bootstrap_membership_idx"
ON "membership_assignments"("membership_id")
WHERE "source" = 'BOOTSTRAP' AND "role" = 'ADMINISTRATOR';

CREATE UNIQUE INDEX "membership_assignments_active_provider_identity_key"
ON "membership_assignments"("external_identity_id")
WHERE "source" = 'AUTHENTICATION_PROVIDER' AND "lifecycle" = 'ACTIVE';

CREATE INDEX "membership_assignments_provider_revision_id_idx"
ON "membership_assignments"("provider_revision_id");

CREATE INDEX "membership_assignments_active_provider_membership_idx"
ON "membership_assignments"("membership_id", "external_identity_id")
WHERE "source" = 'AUTHENTICATION_PROVIDER' AND "lifecycle" = 'ACTIVE';

CREATE UNIQUE INDEX "provider_evidence_states_external_identity_id_key"
ON "provider_evidence_states"("external_identity_id");

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_provider_revision_id_fkey"
FOREIGN KEY ("provider_revision_id") REFERENCES "authentication_provider_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_evidence_states"
ADD CONSTRAINT "provider_evidence_states_external_identity_id_fkey"
FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

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

CREATE FUNCTION protect_provider_evidence_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Provider evidence ordering history cannot be deleted.';
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."external_identity_id" <> OLD."external_identity_id"
       OR NEW."created_at" <> OLD."created_at" THEN
        RAISE EXCEPTION 'Provider evidence ordering identity and history are immutable.';
    END IF;
    IF NEW."last_issued_at" < OLD."last_issued_at"
       OR NEW."updated_at" <= OLD."updated_at"
       OR (
           NEW."last_issued_at" = OLD."last_issued_at"
           AND (
               CASE OLD."last_role"
                   WHEN 'ADMINISTRATOR' THEN 2
                   WHEN 'MEMBER' THEN 1
                   ELSE 0
               END
           ) <= (
               CASE NEW."last_role"
                   WHEN 'ADMINISTRATOR' THEN 2
                   WHEN 'MEMBER' THEN 1
                   ELSE 0
               END
           )
       ) THEN
        RAISE EXCEPTION 'Provider evidence ordering must advance monotonically.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "provider_evidence_states_protected"
BEFORE UPDATE OR DELETE ON "provider_evidence_states"
FOR EACH ROW EXECUTE FUNCTION protect_provider_evidence_state();

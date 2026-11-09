ALTER TABLE "membership_assignments"
DROP CONSTRAINT "membership_assignments_source_contract";

ALTER TABLE "membership_assignments"
ADD CONSTRAINT "membership_assignments_source_contract" CHECK (
    (
        "source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
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

CREATE UNIQUE INDEX "membership_assignments_active_hub_administrator_key"
ON "membership_assignments"("membership_id")
WHERE "source" = 'HUB_ADMINISTRATOR' AND "lifecycle" = 'ACTIVE';

CREATE INDEX "membership_assignments_active_hub_owned_administrator_idx"
ON "membership_assignments"("membership_id")
WHERE "source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
  AND "role" = 'ADMINISTRATOR'
  AND "lifecycle" = 'ACTIVE';

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
    IF OLD."source" = 'HUB_ADMINISTRATOR'
       AND (
           OLD."lifecycle" <> 'ACTIVE'
           OR NEW."lifecycle" <> 'REVOKED'
       ) THEN
        RAISE EXCEPTION 'Administrator-managed assignments may only be revoked.';
    END IF;
    RETURN NEW;
END;
$$;

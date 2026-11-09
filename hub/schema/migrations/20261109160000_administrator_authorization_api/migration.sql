CREATE TABLE "user_profiles" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "login" VARCHAR(200) NOT NULL,
  "name" VARCHAR(200),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_profiles_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "user_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE INDEX "user_profiles_login_idx" ON "user_profiles"("login");

ALTER TABLE "hub_sessions"
  ADD COLUMN "external_identity_id" UUID,
  ADD COLUMN "provider_revision_id" UUID;

DROP TRIGGER "hub_sessions_protected" ON "hub_sessions";

WITH session_identity AS (
  SELECT DISTINCT ON (session."id")
    session."id" AS "session_id",
    identity."id" AS "external_identity_id",
    COALESCE(assignment."provider_revision_id", provider."selected_revision_id")
      AS "provider_revision_id"
  FROM "hub_sessions" session
  JOIN "memberships" membership ON membership."id" = session."membership_id"
  JOIN "external_identities" identity ON identity."user_id" = membership."user_id"
  LEFT JOIN "membership_assignments" assignment
    ON assignment."membership_id" = membership."id"
    AND assignment."external_identity_id" = identity."id"
  LEFT JOIN "authentication_providers" provider
    ON provider."key" = identity."provider"
  ORDER BY session."id", assignment."created_at" DESC NULLS LAST, identity."created_at" DESC
)
UPDATE "hub_sessions" session
SET
  "external_identity_id" = session_identity."external_identity_id",
  "provider_revision_id" = session_identity."provider_revision_id"
FROM session_identity
WHERE session."id" = session_identity."session_id";

CREATE TRIGGER "hub_sessions_protected"
BEFORE UPDATE OR DELETE ON "hub_sessions"
FOR EACH ROW EXECUTE FUNCTION protect_hub_session();

ALTER TABLE "hub_sessions"
  ADD CONSTRAINT "hub_sessions_external_identity_id_fkey"
    FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "hub_sessions_provider_revision_id_fkey"
    FOREIGN KEY ("provider_revision_id") REFERENCES "authentication_provider_revisions"("id") ON DELETE RESTRICT;

CREATE INDEX "hub_sessions_external_identity_id_idx" ON "hub_sessions"("external_identity_id");

CREATE TYPE "SensitiveAuthorizationOperation" AS ENUM (
  'DESIGNATE_ADMINISTRATORS',
  'REVOKE_ADMINISTRATOR'
);

CREATE TABLE "sensitive_authorizations" (
  "id" UUID NOT NULL,
  "hub_session_id" UUID NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "external_identity_id" UUID NOT NULL,
  "operation" "SensitiveAuthorizationOperation" NOT NULL,
  "target_membership_ids" UUID[] NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "verified_at" TIMESTAMPTZ(3),
  "continued_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sensitive_authorizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sensitive_authorizations_hub_session_id_fkey"
    FOREIGN KEY ("hub_session_id") REFERENCES "hub_sessions"("id") ON DELETE RESTRICT,
  CONSTRAINT "sensitive_authorizations_actor_membership_id_fkey"
    FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT,
  CONSTRAINT "sensitive_authorizations_external_identity_id_fkey"
    FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE RESTRICT,
  CONSTRAINT "sensitive_authorizations_targets_check" CHECK (
    cardinality("target_membership_ids") BETWEEN 1 AND 50
    AND (
      "operation" = 'DESIGNATE_ADMINISTRATORS'
      OR cardinality("target_membership_ids") = 1
    )
  ),
  CONSTRAINT "sensitive_authorizations_lifecycle_check" CHECK (
    NOT ("continued_at" IS NOT NULL AND "cancelled_at" IS NOT NULL)
    AND ("continued_at" IS NULL OR "verified_at" IS NOT NULL)
  )
);

CREATE INDEX "sensitive_authorizations_hub_session_id_expires_at_idx"
  ON "sensitive_authorizations"("hub_session_id", "expires_at");
CREATE INDEX "sensitive_authorizations_actor_membership_id_idx"
  ON "sensitive_authorizations"("actor_membership_id");

ALTER TABLE "authorization_attempts"
  ADD COLUMN "sensitive_authorization_id" UUID,
  ADD CONSTRAINT "authorization_attempts_sensitive_authorization_id_fkey"
    FOREIGN KEY ("sensitive_authorization_id") REFERENCES "sensitive_authorizations"("id") ON DELETE RESTRICT;

ALTER TABLE "authorization_attempts"
  ADD CONSTRAINT "authorization_attempts_sensitive_purpose_check" CHECK (
    (
      "purpose" = 'ADMINISTRATOR_MANAGEMENT'
      AND "sensitive_authorization_id" IS NOT NULL
      AND "bootstrap_secret_digest" IS NULL
    )
    OR (
      "purpose" <> 'ADMINISTRATOR_MANAGEMENT'
      AND "sensitive_authorization_id" IS NULL
    )
  );

CREATE UNIQUE INDEX "authorization_attempts_sensitive_authorization_id_key"
  ON "authorization_attempts"("sensitive_authorization_id");

CREATE FUNCTION protect_sensitive_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sensitive authorization history cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" <> OLD."id"
    OR NEW."hub_session_id" <> OLD."hub_session_id"
    OR NEW."actor_membership_id" <> OLD."actor_membership_id"
    OR NEW."external_identity_id" <> OLD."external_identity_id"
    OR NEW."operation" <> OLD."operation"
    OR NEW."target_membership_ids" <> OLD."target_membership_ids"
    OR NEW."expires_at" <> OLD."expires_at"
    OR NEW."created_at" <> OLD."created_at"
    OR OLD."verified_at" IS NOT NULL AND NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
    OR OLD."continued_at" IS NOT NULL AND NEW."continued_at" IS DISTINCT FROM OLD."continued_at"
    OR OLD."cancelled_at" IS NOT NULL AND NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
  ) THEN
    RAISE EXCEPTION 'Sensitive authorization binding and completed transitions are immutable.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'Sensitive authorization updates must advance updated_at.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sensitive_authorizations_protect
BEFORE UPDATE OR DELETE ON "sensitive_authorizations"
FOR EACH ROW EXECUTE FUNCTION protect_sensitive_authorization();

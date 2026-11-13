ALTER TABLE "sensitive_authorizations"
ADD COLUMN "expected_copilot_generation" BIGINT,
ADD COLUMN "check_started_at" TIMESTAMPTZ(3),
ADD COLUMN "check_finished_at" TIMESTAMPTZ(3);

ALTER TABLE "sensitive_authorizations"
ADD CONSTRAINT "sensitive_authorizations_copilot_generation_check" CHECK (
  (
    "operation" IN ('CONNECT_COPILOT', 'DISCONNECT_COPILOT')
    AND "expected_copilot_generation" IS NOT NULL
  )
  OR (
    "operation" NOT IN ('CONNECT_COPILOT', 'DISCONNECT_COPILOT')
    AND "expected_copilot_generation" IS NULL
  )
);

ALTER TABLE "sensitive_authorizations"
DROP CONSTRAINT "sensitive_authorizations_targets_check";

ALTER TABLE "sensitive_authorizations"
ADD CONSTRAINT "sensitive_authorizations_targets_check" CHECK (
  (
    "operation" = 'END_ALL_HUB_SESSIONS'
    AND cardinality("target_membership_ids") = 0
  )
  OR (
    "operation" IN ('CONNECT_COPILOT', 'DISCONNECT_COPILOT', 'REVOKE_ADMINISTRATOR')
    AND cardinality("target_membership_ids") = 1
  )
  OR (
    "operation" = 'DESIGNATE_ADMINISTRATORS'
    AND cardinality("target_membership_ids") BETWEEN 1 AND 50
  )
);

CREATE OR REPLACE FUNCTION protect_sensitive_authorization()
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
    OR NEW."expected_copilot_generation" IS DISTINCT FROM OLD."expected_copilot_generation"
    OR NEW."expires_at" <> OLD."expires_at"
    OR NEW."created_at" <> OLD."created_at"
    OR OLD."check_started_at" IS NOT NULL
      AND NEW."check_started_at" IS DISTINCT FROM OLD."check_started_at"
    OR OLD."check_finished_at" IS NOT NULL
      AND NEW."check_finished_at" IS DISTINCT FROM OLD."check_finished_at"
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

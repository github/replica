ALTER TABLE "sensitive_authorizations"
ADD COLUMN "expected_copilot_generation" BIGINT,
ADD COLUMN "check_started_at" TIMESTAMPTZ(3),
ADD COLUMN "check_finished_at" TIMESTAMPTZ(3);

CREATE TABLE "copilot_connection_states" (
    "id" UUID NOT NULL,
    "connected_by_membership_id" UUID,
    "key" VARCHAR(20) NOT NULL DEFAULT 'global',
    "generation" BIGINT NOT NULL DEFAULT 0,
    "token_digest" CHAR(64),
    "verified_at" TIMESTAMPTZ(3),
    "refused_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_connection_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "copilot_connection_states_key_check" CHECK ("key" = 'global'),
    CONSTRAINT "copilot_connection_states_generation_check" CHECK ("generation" >= 0),
    CONSTRAINT "copilot_connection_states_digest_check" CHECK (
      "token_digest" IS NULL OR "token_digest" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "copilot_connection_states_connection_check" CHECK (
      (
        "connected_by_membership_id" IS NULL
        AND "token_digest" IS NULL
        AND "verified_at" IS NULL
        AND "refused_at" IS NULL
      )
      OR (
        "connected_by_membership_id" IS NOT NULL
        AND "token_digest" IS NOT NULL
        AND "verified_at" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "copilot_connection_states_key_key" ON "copilot_connection_states"("key");

ALTER TABLE "copilot_connection_states"
ADD CONSTRAINT "copilot_connection_states_connected_by_membership_id_fkey"
FOREIGN KEY ("connected_by_membership_id") REFERENCES "memberships"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

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

INSERT INTO "copilot_connection_states" ("id", "key")
VALUES ('00000000-0000-4000-8000-000000000003', 'global');

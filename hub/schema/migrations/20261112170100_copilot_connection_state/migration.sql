ALTER TABLE "sensitive_authorizations"
ADD COLUMN "expected_copilot_generation" BIGINT;

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

INSERT INTO "copilot_connection_states" ("id", "key")
VALUES ('00000000-0000-4000-8000-000000000003', 'global');

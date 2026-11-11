CREATE TABLE "copilot_connection_states" (
  "id" UUID NOT NULL,
  "key" VARCHAR(20) NOT NULL DEFAULT 'global',
  "generation" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_connection_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_connection_states_key_check" CHECK ("key" = 'global'),
  CONSTRAINT "copilot_connection_states_generation_check" CHECK ("generation" >= 0)
);

CREATE UNIQUE INDEX "copilot_connection_states_key_key"
ON "copilot_connection_states"("key");

INSERT INTO "copilot_connection_states" ("id", "key")
VALUES (gen_random_uuid(), 'global');

CREATE TABLE "copilot_connections" (
  "id" UUID NOT NULL,
  "connected_by_membership_id" UUID NOT NULL,
  "key" VARCHAR(20) NOT NULL DEFAULT 'global',
  "token_digest" VARCHAR(64) NOT NULL,
  "verified_at" TIMESTAMPTZ(3) NOT NULL,
  "refused_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_connections_key_check" CHECK ("key" = 'global'),
  CONSTRAINT "copilot_connections_token_digest_check"
    CHECK ("token_digest" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "copilot_connections_key_key"
ON "copilot_connections"("key");

CREATE INDEX "copilot_connections_connected_by_membership_id_idx"
ON "copilot_connections"("connected_by_membership_id");

ALTER TABLE "copilot_connections"
ADD CONSTRAINT "copilot_connections_connected_by_membership_id_fkey"
FOREIGN KEY ("connected_by_membership_id")
REFERENCES "memberships"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

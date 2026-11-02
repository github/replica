CREATE TABLE "authorization_attempts" (
    "id" UUID NOT NULL,
    "provider_revision_id" UUID NOT NULL,
    "state_digest" VARCHAR(64) NOT NULL,
    "browser_binding_digest" VARCHAR(64) NOT NULL,
    "code_challenge" VARCHAR(43) NOT NULL,
    "code_verifier_ciphertext" VARCHAR(500) NOT NULL,
    "request_ip_digest" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authorization_attempts_digests" CHECK (
        "state_digest" ~ '^[0-9a-f]{64}$'
        AND "browser_binding_digest" ~ '^[0-9a-f]{64}$'
        AND "request_ip_digest" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "authorization_attempts_code_challenge" CHECK (
        "code_challenge" ~ '^[A-Za-z0-9_-]{43}$'
    ),
    CONSTRAINT "authorization_attempts_expiry" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "authorization_attempts_consumption" CHECK (
        "consumed_at" IS NULL OR "consumed_at" >= "created_at"
    )
);

CREATE TABLE "authentication_revocation_generations" (
    "id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "generation" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_revocation_generations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authentication_revocation_generations_key_present" CHECK (length("key") > 0),
    CONSTRAINT "authentication_revocation_generations_global_key" CHECK ("key" = 'global'),
    CONSTRAINT "authentication_revocation_generations_positive" CHECK ("generation" > 0)
);

CREATE TABLE "authentication_rate_limits" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "key_digest" VARCHAR(64) NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "reservation_count" INTEGER NOT NULL,
    "denial_audited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_rate_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authentication_rate_limits_scope" CHECK (
        "scope" IN ('github_callback', 'github_start')
    ),
    CONSTRAINT "authentication_rate_limits_digest" CHECK (
        "key_digest" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "authentication_rate_limits_count" CHECK ("reservation_count" > 0)
);

CREATE UNIQUE INDEX "authorization_attempts_state_digest_key"
ON "authorization_attempts"("state_digest");
CREATE INDEX "authorization_attempts_expires_at_idx" ON "authorization_attempts"("expires_at");
CREATE INDEX "authorization_attempts_request_ip_digest_created_at_idx"
ON "authorization_attempts"("request_ip_digest", "created_at");
CREATE UNIQUE INDEX "authentication_revocation_generations_key_key"
ON "authentication_revocation_generations"("key");
CREATE UNIQUE INDEX "authentication_rate_limits_scope_key_digest_key"
ON "authentication_rate_limits"("scope", "key_digest");
CREATE INDEX "authentication_rate_limits_window_started_at_idx"
ON "authentication_rate_limits"("window_started_at");

ALTER TABLE "authorization_attempts"
ADD CONSTRAINT "authorization_attempts_provider_revision_id_fkey"
FOREIGN KEY ("provider_revision_id") REFERENCES "authentication_provider_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION protect_authorization_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."expires_at" > CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION 'Unexpired authorization attempts cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."provider_revision_id" <> OLD."provider_revision_id"
       OR NEW."state_digest" <> OLD."state_digest"
       OR NEW."browser_binding_digest" <> OLD."browser_binding_digest"
       OR NEW."code_challenge" <> OLD."code_challenge"
       OR NEW."code_verifier_ciphertext" <> OLD."code_verifier_ciphertext"
       OR NEW."request_ip_digest" <> OLD."request_ip_digest"
       OR NEW."expires_at" <> OLD."expires_at"
       OR NEW."created_at" <> OLD."created_at"
       OR OLD."consumed_at" IS NOT NULL
       OR NEW."consumed_at" IS NULL THEN
        RAISE EXCEPTION 'Authorization attempt history is immutable except for first consumption.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "authorization_attempts_protected"
BEFORE UPDATE OR DELETE ON "authorization_attempts"
FOR EACH ROW EXECUTE FUNCTION protect_authorization_attempt();

CREATE FUNCTION protect_authentication_revocation_generation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE'
       OR NEW."id" <> OLD."id"
       OR NEW."key" <> OLD."key"
       OR NEW."generation" <= OLD."generation"
       OR NEW."created_at" <> OLD."created_at" THEN
        RAISE EXCEPTION 'Authentication revocation generation may only increase.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "authentication_revocation_generations_protected"
BEFORE UPDATE OR DELETE ON "authentication_revocation_generations"
FOR EACH ROW EXECUTE FUNCTION protect_authentication_revocation_generation();

INSERT INTO "authentication_revocation_generations" (
    "id",
    "key",
    "generation"
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    'global',
    1
);

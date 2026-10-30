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

CREATE TABLE "admission_handoffs" (
    "id" UUID NOT NULL,
    "external_identity_id" UUID NOT NULL,
    "provider_revision_id" UUID NOT NULL,
    "token_digest" VARCHAR(64) NOT NULL,
    "browser_binding_digest" VARCHAR(64) NOT NULL,
    "revocation_generation" BIGINT NOT NULL,
    "display_attributes" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_handoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admission_handoffs_digests" CHECK (
        "token_digest" ~ '^[0-9a-f]{64}$'
        AND "browser_binding_digest" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "admission_handoffs_generation" CHECK ("revocation_generation" > 0),
    CONSTRAINT "admission_handoffs_display_object" CHECK (
        jsonb_typeof("display_attributes") = 'object'
    ),
    CONSTRAINT "admission_handoffs_display_bounded" CHECK (
        pg_column_size("display_attributes") <= 4096
    ),
    CONSTRAINT "admission_handoffs_expiry" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "admission_handoffs_consumption" CHECK (
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

CREATE UNIQUE INDEX "authorization_attempts_state_digest_key"
ON "authorization_attempts"("state_digest");
CREATE INDEX "authorization_attempts_expires_at_idx" ON "authorization_attempts"("expires_at");
CREATE INDEX "authorization_attempts_request_ip_digest_created_at_idx"
ON "authorization_attempts"("request_ip_digest", "created_at");
CREATE UNIQUE INDEX "admission_handoffs_token_digest_key"
ON "admission_handoffs"("token_digest");
CREATE INDEX "admission_handoffs_expires_at_idx" ON "admission_handoffs"("expires_at");
CREATE INDEX "admission_handoffs_external_identity_id_idx"
ON "admission_handoffs"("external_identity_id");
CREATE UNIQUE INDEX "authentication_revocation_generations_key_key"
ON "authentication_revocation_generations"("key");

ALTER TABLE "authorization_attempts"
ADD CONSTRAINT "authorization_attempts_provider_revision_id_fkey"
FOREIGN KEY ("provider_revision_id") REFERENCES "authentication_provider_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admission_handoffs"
ADD CONSTRAINT "admission_handoffs_external_identity_id_fkey"
FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admission_handoffs"
ADD CONSTRAINT "admission_handoffs_provider_revision_id_fkey"
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

CREATE FUNCTION protect_admission_handoff()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."expires_at" > CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION 'Unexpired admission handoffs cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."external_identity_id" <> OLD."external_identity_id"
       OR NEW."provider_revision_id" <> OLD."provider_revision_id"
       OR NEW."token_digest" <> OLD."token_digest"
       OR NEW."browser_binding_digest" <> OLD."browser_binding_digest"
       OR NEW."revocation_generation" <> OLD."revocation_generation"
       OR NEW."display_attributes" <> OLD."display_attributes"
       OR NEW."expires_at" <> OLD."expires_at"
       OR NEW."created_at" <> OLD."created_at"
       OR OLD."consumed_at" IS NOT NULL
       OR NEW."consumed_at" IS NULL THEN
        RAISE EXCEPTION 'Admission handoff history is immutable except for first consumption.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "admission_handoffs_protected"
BEFORE UPDATE OR DELETE ON "admission_handoffs"
FOR EACH ROW EXECUTE FUNCTION protect_admission_handoff();

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

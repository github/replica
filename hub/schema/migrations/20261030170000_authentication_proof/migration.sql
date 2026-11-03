CREATE TABLE "authorization_attempts" (
    "id" UUID NOT NULL,
    "provider_revision_id" UUID NOT NULL,
    "state_digest" VARCHAR(64) NOT NULL,
    "browser_binding_digest" VARCHAR(64) NOT NULL,
    "code_verifier_ciphertext" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authorization_attempts_digests" CHECK (
        "state_digest" ~ '^[0-9a-f]{64}$'
        AND "browser_binding_digest" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "authorization_attempts_expiry" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "authorization_attempts_consumption" CHECK (
        "consumed_at" IS NULL OR "consumed_at" >= "created_at"
    )
);

CREATE UNIQUE INDEX "authorization_attempts_state_digest_key"
ON "authorization_attempts"("state_digest");
CREATE INDEX "authorization_attempts_expires_at_idx" ON "authorization_attempts"("expires_at");
CREATE INDEX "authorization_attempts_consumed_at_idx" ON "authorization_attempts"("consumed_at");

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

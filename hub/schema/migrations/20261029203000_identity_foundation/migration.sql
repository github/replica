CREATE TYPE "SecurityAuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "issuer" VARCHAR(500) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_identities_values_present" CHECK (
        length("provider") > 0 AND length("issuer") > 0 AND length("subject") > 0
    )
);

CREATE TABLE "authentication_providers" (
    "id" UUID NOT NULL,
    "selected_revision_id" UUID,
    "key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_providers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authentication_providers_key_present" CHECK (length("key") > 0)
);

CREATE TABLE "authentication_provider_revisions" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "configuration_digest" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_provider_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authentication_provider_revisions_revision_positive" CHECK ("revision" > 0),
    CONSTRAINT "authentication_provider_revisions_digest_sha256" CHECK (
        "configuration_digest" ~ '^[0-9a-f]{64}$'
    )
);

CREATE TABLE "security_audits" (
    "id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "outcome" "SecurityAuditOutcome" NOT NULL,
    "target_type" VARCHAR(100) NOT NULL,
    "target_id" VARCHAR(100),
    "context" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "security_audits_values_present" CHECK (
        length("action") > 0 AND length("target_type") > 0
    ),
    CONSTRAINT "security_audits_context_object" CHECK (jsonb_typeof("context") = 'object'),
    CONSTRAINT "security_audits_context_bounded" CHECK (pg_column_size("context") <= 4096)
);

CREATE UNIQUE INDEX "external_identities_provider_issuer_subject_key"
ON "external_identities"("provider", "issuer", "subject");

CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

CREATE UNIQUE INDEX "authentication_providers_selected_revision_id_key"
ON "authentication_providers"("selected_revision_id");

CREATE UNIQUE INDEX "authentication_providers_key_key" ON "authentication_providers"("key");

CREATE UNIQUE INDEX "authentication_provider_revisions_provider_id_revision_key"
ON "authentication_provider_revisions"("provider_id", "revision");

CREATE INDEX "authentication_provider_revisions_provider_id_idx"
ON "authentication_provider_revisions"("provider_id");

CREATE INDEX "security_audits_action_created_at_idx"
ON "security_audits"("action", "created_at");

ALTER TABLE "external_identities"
ADD CONSTRAINT "external_identities_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "authentication_provider_revisions"
ADD CONSTRAINT "authentication_provider_revisions_provider_id_fkey"
FOREIGN KEY ("provider_id") REFERENCES "authentication_providers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "authentication_providers"
ADD CONSTRAINT "authentication_providers_selected_revision_id_fkey"
FOREIGN KEY ("selected_revision_id") REFERENCES "authentication_provider_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE
DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION prevent_external_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'External identity records are immutable.';
END;
$$;

CREATE TRIGGER "external_identities_immutable"
BEFORE UPDATE OR DELETE ON "external_identities"
FOR EACH ROW EXECUTE FUNCTION prevent_external_identity_changes();

CREATE FUNCTION prevent_authentication_provider_revision_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Authentication provider revisions are immutable.';
END;
$$;

CREATE TRIGGER "authentication_provider_revisions_immutable"
BEFORE UPDATE OR DELETE ON "authentication_provider_revisions"
FOR EACH ROW EXECUTE FUNCTION prevent_authentication_provider_revision_changes();

CREATE FUNCTION prevent_security_audit_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Security audit records are immutable.';
END;
$$;

CREATE TRIGGER "security_audits_immutable"
BEFORE UPDATE OR DELETE ON "security_audits"
FOR EACH ROW EXECUTE FUNCTION prevent_security_audit_changes();

CREATE FUNCTION enforce_selected_revision_provider()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_revision UUID;
BEGIN
    SELECT "selected_revision_id"
    INTO selected_revision
    FROM "authentication_providers"
    WHERE "id" = NEW."id";

    IF selected_revision IS NULL THEN
        RAISE EXCEPTION 'Authentication provider must have a selected revision.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "authentication_provider_revisions"
        WHERE "id" = selected_revision
          AND "provider_id" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'Selected revision must belong to its authentication provider.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "authentication_provider_selected_revision_owner"
AFTER INSERT OR UPDATE OF "selected_revision_id" ON "authentication_providers"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_selected_revision_provider();

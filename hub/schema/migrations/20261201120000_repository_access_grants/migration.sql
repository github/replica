ALTER TABLE "repositories" ADD COLUMN "github_repository_id" BIGINT;

ALTER TABLE "hub_sessions" ADD COLUMN "end_reason" VARCHAR(50);
ALTER TABLE "hub_sessions" ADD CONSTRAINT "hub_sessions_end_reason_valid"
CHECK ("end_reason" IS NULL OR ("end_reason" = 'GITHUB_REPOSITORY_ACCESS_REVOKED' AND "ended_at" IS NOT NULL));

CREATE UNIQUE INDEX "repositories_github_repository_id_key" ON "repositories"("github_repository_id");

CREATE TABLE "repository_access_grants" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repository_access_grants_membership_id_repository_id_key" ON "repository_access_grants"("membership_id", "repository_id");
CREATE INDEX "repository_access_grants_repository_id_idx" ON "repository_access_grants"("repository_id");

ALTER TABLE "repository_access_grants"
ADD CONSTRAINT "repository_access_grants_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "repository_access_grants"
ADD CONSTRAINT "repository_access_grants_repository_id_fkey"
FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "github_repository_access_states" (
    "id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "github_repository_access_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "github_repository_access_states_singleton" CHECK ("key" = 'global')
);

CREATE UNIQUE INDEX "github_repository_access_states_key_key"
ON "github_repository_access_states"("key");

INSERT INTO "github_repository_access_states" ("id", "key", "revision")
VALUES (gen_random_uuid(), 'global', 0);

-- This fence orders GitHub access evidence across all concurrent writers.
CREATE FUNCTION protect_github_repository_access_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'GitHub repository access authority cannot be deleted.';
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."key" <> OLD."key"
       OR NEW."created_at" <> OLD."created_at"
       OR NEW."revision" <> OLD."revision" + 1
       OR NEW."changed_at" IS NULL
       OR (OLD."changed_at" IS NOT NULL AND NEW."changed_at" <= OLD."changed_at") THEN
        RAISE EXCEPTION 'GitHub repository access authority must advance monotonically.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "github_repository_access_states_protected"
BEFORE UPDATE OR DELETE ON "github_repository_access_states"
FOR EACH ROW EXECUTE FUNCTION protect_github_repository_access_state();

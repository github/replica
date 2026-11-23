BEGIN;

ALTER TABLE "private_preview_access" RENAME TO "private_preview_accesses";
ALTER INDEX "private_preview_access_expires_at_idx" RENAME TO "private_preview_accesses_expires_at_idx";

-- Existing rows have no historical timestamps; record when they were migrated.
ALTER TABLE "private_preview_accesses"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "private_preview_accesses_token_digest_key" ON "private_preview_accesses"("token_digest");
ALTER TABLE "private_preview_accesses"
  ALTER COLUMN "id" DROP DEFAULT,
  DROP CONSTRAINT "private_preview_access_pkey",
  ADD CONSTRAINT "private_preview_accesses_pkey" PRIMARY KEY ("id");

CREATE INDEX "private_preview_accesses_build_id_idx" ON "private_preview_accesses"("build_id");
ALTER TABLE "private_preview_accesses"
  ADD CONSTRAINT "private_preview_accesses_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- Enforce the FK on new references, but preserve legacy orphans until access expiry removes them.
DO $$
BEGIN
  ALTER TABLE "private_preview_accesses" VALIDATE CONSTRAINT "private_preview_accesses_build_id_fkey";
EXCEPTION WHEN foreign_key_violation THEN
  NULL;
END;
$$;

COMMIT;

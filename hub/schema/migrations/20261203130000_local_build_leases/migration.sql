ALTER TABLE "builds"
ADD COLUMN "local_lease_id" UUID,
ADD COLUMN "local_lease_expires_at" TIMESTAMPTZ(3);

UPDATE "builds"
SET "state" = 'queued',
    "started_at" = NULL
FROM "prototypes", "repositories"
WHERE "builds"."prototype_id" = "prototypes"."id"
  AND "prototypes"."repository_id" = "repositories"."id"
  AND "repositories"."local_path" IS NOT NULL
  AND "builds"."state" = 'running';

ALTER TABLE "builds"
ADD CONSTRAINT "builds_local_lease_check"
CHECK (
  ("local_lease_id" IS NULL AND "local_lease_expires_at" IS NULL)
  OR (
    "local_lease_id" IS NOT NULL
    AND "local_lease_expires_at" IS NOT NULL
    AND "state" = 'running'
  )
);

CREATE TYPE "BuildState" AS ENUM ('queued', 'running', 'failed', 'successful', 'superseded');

ALTER TABLE "prototypes" ADD COLUMN "current_build_id" UUID;

CREATE TABLE "builds" (
    "id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "state" "BuildState" NOT NULL DEFAULT 'queued',
    "workflow_created_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "builds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "builds_number_check" CHECK ("number" > 0)
);

CREATE UNIQUE INDEX "builds_id_prototype_id_key" ON "builds"("id", "prototype_id");
CREATE UNIQUE INDEX "builds_prototype_id_number_key" ON "builds"("prototype_id", "number");
CREATE INDEX "builds_prototype_chronology_idx" ON "builds"(
    "prototype_id",
    COALESCE("workflow_created_at", "created_at") DESC,
    "number" DESC
);

ALTER TABLE "builds"
ADD CONSTRAINT "builds_prototype_id_fkey"
FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prototypes"
ADD CONSTRAINT "prototypes_current_build_id_id_fkey"
FOREIGN KEY ("current_build_id", "id") REFERENCES "builds"("id", "prototype_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

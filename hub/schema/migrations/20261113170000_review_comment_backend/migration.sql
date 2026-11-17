CREATE TYPE "ReviewThreadResolutionState" AS ENUM ('RESOLVED', 'REOPENED');

ALTER TABLE "prototypes"
ADD CONSTRAINT "prototypes_id_repository_id_key" UNIQUE ("id", "repository_id");

CREATE TABLE "review_threads" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "resolved_by_id" UUID,
    "anchor" JSONB NOT NULL,
    "activity_version" INTEGER NOT NULL DEFAULT 1,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_comments" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "root_id" UUID,
    "author_id" UUID NOT NULL,
    "public_id" SERIAL NOT NULL,
    "author_login" VARCHAR(200) NOT NULL,
    "author_name" VARCHAR(200),
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_thread_resolution_events" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" "ReviewThreadResolutionState" NOT NULL,
    "actor_login" VARCHAR(200) NOT NULL,
    "actor_name" VARCHAR(200),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_thread_resolution_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_threads_repository_id_created_at_id_idx"
ON "review_threads"("repository_id", "created_at", "id");
CREATE INDEX "review_threads_prototype_id_created_at_id_idx"
ON "review_threads"("prototype_id", "created_at", "id");
CREATE INDEX "review_threads_resolved_by_id_idx"
ON "review_threads"("resolved_by_id");

CREATE UNIQUE INDEX "review_comments_id_thread_id_key"
ON "review_comments"("id", "thread_id");
CREATE UNIQUE INDEX "review_comments_public_id_key"
ON "review_comments"("public_id");
CREATE UNIQUE INDEX "review_comments_one_root_per_thread"
ON "review_comments"("thread_id") WHERE "root_id" IS NULL;
CREATE INDEX "review_comments_thread_id_created_at_id_idx"
ON "review_comments"("thread_id", "created_at", "id");
CREATE INDEX "review_comments_root_id_idx"
ON "review_comments"("root_id");
CREATE INDEX "review_comments_author_id_idx"
ON "review_comments"("author_id");

CREATE UNIQUE INDEX "review_thread_resolution_events_thread_id_sequence_key"
ON "review_thread_resolution_events"("thread_id", "sequence");
CREATE INDEX "review_thread_resolution_events_actor_id_idx"
ON "review_thread_resolution_events"("actor_id");

ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_activity_version_check"
CHECK ("activity_version" > 0);
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_resolution_check"
CHECK (
    ("resolved_at" IS NULL AND "resolved_by_id" IS NULL)
    OR ("resolved_at" IS NOT NULL AND "resolved_by_id" IS NOT NULL)
);
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_anchor_check"
CHECK (jsonb_typeof("anchor") = 'object');
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_root_not_self_check"
CHECK ("root_id" IS NULL OR "root_id" <> "id");
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_body_check"
CHECK (
    octet_length(btrim("body")) > 0
    AND octet_length("body") <= 10000
);
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_edit_state_check"
CHECK ("edited_at" IS NULL OR "edited_at" >= "created_at");
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_deletion_time_check"
CHECK ("deleted_at" IS NULL OR "deleted_at" >= "created_at");
ALTER TABLE "review_thread_resolution_events"
ADD CONSTRAINT "review_thread_resolution_events_sequence_check"
CHECK ("sequence" > 1);

ALTER TABLE "review_threads"
ADD CONSTRAINT "review_threads_repository_id_fkey"
FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_threads"
ADD CONSTRAINT "review_threads_prototype_id_repository_id_fkey"
FOREIGN KEY ("prototype_id", "repository_id")
REFERENCES "prototypes"("id", "repository_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_threads"
ADD CONSTRAINT "review_threads_build_id_prototype_id_fkey"
FOREIGN KEY ("build_id", "prototype_id")
REFERENCES "builds"("id", "prototype_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_threads"
ADD CONSTRAINT "review_threads_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_comments"
ADD CONSTRAINT "review_comments_thread_id_fkey"
FOREIGN KEY ("thread_id") REFERENCES "review_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_comments"
ADD CONSTRAINT "review_comments_root_id_thread_id_fkey"
FOREIGN KEY ("root_id", "thread_id")
REFERENCES "review_comments"("id", "thread_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_comments"
ADD CONSTRAINT "review_comments_author_id_fkey"
FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_thread_resolution_events"
ADD CONSTRAINT "review_thread_resolution_events_thread_id_fkey"
FOREIGN KEY ("thread_id") REFERENCES "review_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_thread_resolution_events"
ADD CONSTRAINT "review_thread_resolution_events_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

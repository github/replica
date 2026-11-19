CREATE TYPE "ReviewNotificationKind" AS ENUM ('comment', 'mention', 'reply', 'reaction', 'resolved', 'reopened');

ALTER TABLE "review_threads" ADD COLUMN "collaboration_version" INTEGER NOT NULL DEFAULT 1;
UPDATE "review_threads" SET "collaboration_version" = "activity_version" WHERE "activity_version" <> 1;

CREATE TABLE "review_reactions" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" VARCHAR(8) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_reactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "review_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "review_reactions_comment_id_user_id_content_key" ON "review_reactions"("comment_id", "user_id", "content");
CREATE INDEX "review_reactions_user_id_idx" ON "review_reactions"("user_id");

CREATE TABLE "review_mentions" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "recipient_key" VARCHAR(64) NOT NULL,
    "login" VARCHAR(39) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_mentions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "review_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "review_mentions_comment_id_recipient_key_key" ON "review_mentions"("comment_id", "recipient_key");

CREATE TABLE "review_thread_reads" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "activity_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_thread_reads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_thread_reads_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "review_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_thread_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "review_thread_reads_thread_id_user_id_key" ON "review_thread_reads"("thread_id", "user_id");
CREATE INDEX "review_thread_reads_user_id_idx" ON "review_thread_reads"("user_id");

CREATE TABLE "review_notifications" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "mention_id" UUID,
    "reaction_id" UUID,
    "public_id" SERIAL NOT NULL,
    "recipient_key" VARCHAR(64) NOT NULL,
    "source_key" VARCHAR(64) NOT NULL,
    "kind" "ReviewNotificationKind" NOT NULL,
    "actor_login" VARCHAR(200) NOT NULL,
    "actor_name" VARCHAR(200),
    "reaction_content" VARCHAR(8),
    "read_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "review_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_notifications_mention_id_fkey" FOREIGN KEY ("mention_id") REFERENCES "review_mentions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_notifications_reaction_id_fkey" FOREIGN KEY ("reaction_id") REFERENCES "review_reactions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "review_notifications_public_id_key" ON "review_notifications"("public_id");
CREATE UNIQUE INDEX "review_notifications_recipient_key_source_key_key" ON "review_notifications"("recipient_key", "source_key");
CREATE INDEX "review_notifications_recipient_key_public_id_idx" ON "review_notifications"("recipient_key", "public_id");
CREATE INDEX "review_notifications_comment_id_idx" ON "review_notifications"("comment_id");
CREATE INDEX "review_notifications_actor_id_idx" ON "review_notifications"("actor_id");
CREATE INDEX "review_notifications_mention_id_idx" ON "review_notifications"("mention_id");
CREATE INDEX "review_notifications_reaction_id_idx" ON "review_notifications"("reaction_id");

-- A transaction publishes only after commit; repeated changes to the same prototype can coalesce.
CREATE FUNCTION "notify_review_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.collaboration_version IS DISTINCT FROM OLD.collaboration_version THEN
        PERFORM pg_notify('hub_review_changes', NEW.repository_id::text || ':' || NEW.prototype_id::text);
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER "review_threads_changed" AFTER INSERT OR UPDATE OF "collaboration_version"
ON "review_threads" FOR EACH ROW EXECUTE FUNCTION "notify_review_change"();

CREATE TYPE "ReviewOutcomeKind" AS ENUM (
    'CONFIRMED_FIXED',
    'STILL_PRESENT',
    'NOT_APPLICABLE',
    'NEEDS_MORE_REVIEW'
);

CREATE TABLE "review_outcomes" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "verifier_id" UUID NOT NULL,
    "resolution_event_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "ReviewOutcomeKind" NOT NULL,
    "feedback_digest" VARCHAR(71) NOT NULL,
    "verifier_login" VARCHAR(200) NOT NULL,
    "verifier_name" VARCHAR(200),
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_outcomes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_outcomes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "review_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_outcomes_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_outcomes_verifier_id_fkey" FOREIGN KEY ("verifier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_outcomes_resolution_event_id_fkey" FOREIGN KEY ("resolution_event_id") REFERENCES "review_thread_resolution_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "review_outcomes_thread_id_sequence_key" ON "review_outcomes"("thread_id", "sequence");
CREATE INDEX "review_outcomes_build_id_idx" ON "review_outcomes"("build_id");
CREATE INDEX "review_outcomes_verifier_id_idx" ON "review_outcomes"("verifier_id");
CREATE INDEX "review_outcomes_resolution_event_id_idx" ON "review_outcomes"("resolution_event_id");

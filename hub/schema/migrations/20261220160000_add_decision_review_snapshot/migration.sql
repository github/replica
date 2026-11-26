-- CreateTable
CREATE TABLE "decision_review_snapshots" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "digest" VARCHAR(71) NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_review_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_review_snapshots_repository_id_key" ON "decision_review_snapshots"("repository_id");

-- AddForeignKey
ALTER TABLE "decision_review_snapshots" ADD CONSTRAINT "decision_review_snapshots_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

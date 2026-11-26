-- CreateTable
CREATE TABLE "learning_shares" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "shared_by_membership_id" UUID,
    "withdrawn_by_membership_id" UUID,
    "learning_id" VARCHAR(255) NOT NULL,
    "shared_at" TIMESTAMPTZ(3) NOT NULL,
    "withdrawn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learning_shares_repository_id_learning_id_key" ON "learning_shares"("repository_id", "learning_id");

-- AddForeignKey
ALTER TABLE "learning_shares" ADD CONSTRAINT "learning_shares_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_shares" ADD CONSTRAINT "learning_shares_shared_by_membership_id_fkey" FOREIGN KEY ("shared_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_shares" ADD CONSTRAINT "learning_shares_withdrawn_by_membership_id_fkey" FOREIGN KEY ("withdrawn_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

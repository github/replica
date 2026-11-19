ALTER TABLE "security_audits" ADD COLUMN "repository_id" UUID;

ALTER TABLE "security_audits"
ADD CONSTRAINT "security_audits_repository_id_fkey"
FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "security_audits_repository_id_created_at_id_idx"
ON "security_audits"("repository_id", "created_at" DESC, "id" DESC);

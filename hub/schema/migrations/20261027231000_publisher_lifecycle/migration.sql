-- AlterTable
ALTER TABLE "security_audits" ADD COLUMN "workload_credential_id" UUID;

-- CreateIndex
CREATE INDEX "security_audits_workload_credential_id_idx" ON "security_audits"("workload_credential_id");

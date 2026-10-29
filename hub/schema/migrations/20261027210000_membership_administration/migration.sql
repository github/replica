-- AlterTable
ALTER TABLE "identity_store_states" ADD COLUMN "bootstrap_completed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "installation_memberships"
ADD COLUMN "suspended_at" TIMESTAMPTZ(3),
ADD COLUMN "removed_at" TIMESTAMPTZ(3);

-- Existing foundation records are active and must satisfy the lifecycle constraint.
UPDATE "installation_memberships"
SET "suspended_at" = CASE WHEN "status" = 'suspended' THEN CURRENT_TIMESTAMP ELSE NULL END;

-- Replace the cascading user relation so retained membership and audit linkage cannot disappear.
ALTER TABLE "installation_memberships" DROP CONSTRAINT "installation_memberships_user_id_fkey";
ALTER TABLE "installation_memberships" ADD CONSTRAINT "installation_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "installation_memberships" ADD CONSTRAINT "installation_memberships_status" CHECK ("status" IN ('active', 'suspended', 'removed'));

-- AddCheckConstraint
ALTER TABLE "installation_memberships" ADD CONSTRAINT "installation_memberships_role" CHECK ("role" IN ('member', 'administrator'));

-- AddCheckConstraint
ALTER TABLE "installation_memberships" ADD CONSTRAINT "installation_memberships_source" CHECK ("source" IN ('bootstrap', 'invitation', 'manual', 'recovery', 'synchronized'));

-- AddCheckConstraint
ALTER TABLE "installation_memberships" ADD CONSTRAINT "installation_memberships_lifecycle" CHECK (
    ("status" = 'active' AND "suspended_at" IS NULL AND "removed_at" IS NULL) OR
    ("status" = 'suspended' AND "suspended_at" IS NOT NULL AND "removed_at" IS NULL) OR
    ("status" = 'removed' AND "removed_at" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "membership_invitations" (
    "id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "activated_identity_id" UUID,
    "activated_membership_id" UUID,
    "provider" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_invitations_role" CHECK ("role" IN ('member', 'administrator')),
    CONSTRAINT "membership_invitations_lifecycle" CHECK (NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "membership_invitations_provider_issuer_subject_idx" ON "membership_invitations"("provider", "issuer", "subject");

-- CreateIndex
CREATE INDEX "membership_invitations_expires_at_idx" ON "membership_invitations"("expires_at");

-- CreateIndex
CREATE INDEX "membership_invitations_created_by_user_id_idx" ON "membership_invitations"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_invitations_usable_assignment_key" ON "membership_invitations"("provider", "issuer", "subject") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

-- AddForeignKey
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_activated_identity_id_fkey" FOREIGN KEY ("activated_identity_id") REFERENCES "external_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_activated_membership_id_fkey" FOREIGN KEY ("activated_membership_id") REFERENCES "installation_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "security_audits"
ADD COLUMN "target_membership_id" UUID,
ADD COLUMN "invitation_id" UUID,
ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'succeeded',
ADD COLUMN "context" JSONB NOT NULL DEFAULT '{}';

UPDATE "security_audits"
SET "outcome" = 'denied'
WHERE "event" = 'authentication.admission_denied';

UPDATE "security_audits"
SET "outcome" = 'failed'
WHERE "event" = 'authentication.provider_failed';

-- AddCheckConstraint
ALTER TABLE "security_audits" ADD CONSTRAINT "security_audits_outcome" CHECK ("outcome" IN ('succeeded', 'denied', 'failed'));

-- AddCheckConstraint
ALTER TABLE "security_audits" ADD CONSTRAINT "security_audits_context" CHECK (jsonb_typeof("context") = 'object');

-- CreateIndex
CREATE INDEX "security_audits_target_membership_id_idx" ON "security_audits"("target_membership_id");

-- CreateIndex
CREATE INDEX "security_audits_invitation_id_idx" ON "security_audits"("invitation_id");

-- AddForeignKey
ALTER TABLE "security_audits" ADD CONSTRAINT "security_audits_target_membership_id_fkey" FOREIGN KEY ("target_membership_id") REFERENCES "installation_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_audits" ADD CONSTRAINT "security_audits_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "membership_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

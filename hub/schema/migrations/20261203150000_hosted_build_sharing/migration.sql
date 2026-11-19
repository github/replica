-- Existing local links have no external creator and retain their original policy.
ALTER TABLE "share_links" ADD COLUMN "created_by_external_identity_id" UUID;

CREATE INDEX "share_links_created_by_external_identity_id_idx"
ON "share_links"("created_by_external_identity_id");

ALTER TABLE "share_links"
ADD CONSTRAINT "share_links_created_by_external_identity_id_fkey"
FOREIGN KEY ("created_by_external_identity_id") REFERENCES "external_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_identities"
ADD COLUMN "email" TEXT,
ADD COLUMN "directory_object_id" TEXT;

CREATE UNIQUE INDEX "external_identities_provider_issuer_directory_object_id_key"
ON "external_identities"("provider", "issuer", "directory_object_id");

ALTER TABLE "installation_memberships"
DROP CONSTRAINT "installation_memberships_source";

ALTER TABLE "installation_memberships"
ADD CONSTRAINT "installation_memberships_source"
CHECK ("source" IN (
  'bootstrap',
  'invitation',
  'legacy-synchronized',
  'manual',
  'oidc-assignment',
  'recovery',
  'synchronized'
));

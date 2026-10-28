ALTER TABLE "external_identities" ADD COLUMN "directory_object_id" TEXT;

CREATE UNIQUE INDEX "external_identities_provider_issuer_directory_object_id_key"
ON "external_identities"("provider", "issuer", "directory_object_id");

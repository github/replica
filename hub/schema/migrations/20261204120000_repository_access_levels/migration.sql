CREATE TYPE "RepositoryAccessLevel" AS ENUM ('READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN');

ALTER TABLE "repository_access_grants"
ADD COLUMN "access_level" "RepositoryAccessLevel" NOT NULL DEFAULT 'READ';

-- Existing grants prove repository visibility only. Fresh GitHub sign-in evidence is
-- required before a membership receives repository-administrator authority.

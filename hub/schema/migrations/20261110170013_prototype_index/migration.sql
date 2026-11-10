-- CreateTable
CREATE TABLE "prototypes" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "author_id" UUID,
    "branch_name" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "description" VARCHAR(500),
    "registered_at" TIMESTAMPTZ(3),
    "branch_deleted_at" TIMESTAMPTZ(3),
    "replica" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prototypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "name_with_owner" VARCHAR(255) NOT NULL,
    "default_branch" VARCHAR(255) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prototypes_repository_id_registered_at_id_idx" ON "prototypes"("repository_id", "registered_at", "id");

-- CreateIndex
CREATE INDEX "prototypes_author_id_idx" ON "prototypes"("author_id");

-- AddForeignKey
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active branch has one prototype identity, even when writers race.
CREATE UNIQUE INDEX "prototypes_active_branch_key"
ON "prototypes"("repository_id", "branch_name")
WHERE "branch_deleted_at" IS NULL;

-- Reject names that are blank to either JavaScript or Rails.
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_registration_check"
CHECK (
    "registered_at" IS NULL OR (
        "name" IS NOT NULL
        AND translate(
            "name",
            chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
            chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
            chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
            chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
            chr(8239) || chr(8287) || chr(12288) || chr(65279),
            ''
        ) <> ''
        AND NOT "replica"
    )
);

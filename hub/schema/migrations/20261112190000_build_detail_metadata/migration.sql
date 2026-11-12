ALTER TABLE "builds"
ADD COLUMN "commit_sha" VARCHAR(64),
ADD COLUMN "author_provider" VARCHAR(100),
ADD COLUMN "author_issuer" VARCHAR(500),
ADD COLUMN "author_provider_user_id" VARCHAR(500),
ADD COLUMN "author_login" VARCHAR(255),
ADD COLUMN "author_name" VARCHAR(255),
ADD COLUMN "author_avatar_url" VARCHAR(2048),
ADD COLUMN "started_at" TIMESTAMPTZ(3),
ADD COLUMN "finished_at" TIMESTAMPTZ(3),
ADD COLUMN "failure_summary" VARCHAR(1000);

CREATE UNIQUE INDEX "builds_prototype_id_commit_sha_key"
ON "builds"("prototype_id", "commit_sha");

-- A canonical SHA keeps the same commit from being recorded under different spellings.
ALTER TABLE "builds" ADD CONSTRAINT "builds_commit_sha_check"
CHECK ("commit_sha" IS NULL OR "commit_sha" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$');

-- A provider user ID identifies an author only with its provider and issuer.
ALTER TABLE "builds" ADD CONSTRAINT "builds_author_identity_check"
CHECK (
    (
        "author_provider" IS NULL
        AND "author_issuer" IS NULL
        AND "author_provider_user_id" IS NULL
    ) OR (
        "author_provider" IS NOT NULL
        AND "author_issuer" IS NOT NULL
        AND "author_provider_user_id" IS NOT NULL
        AND translate(
            "author_provider",
            chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
            chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
            chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
            chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
            chr(8239) || chr(8287) || chr(12288) || chr(65279),
            ''
        ) <> ''
        AND translate(
            "author_issuer",
            chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
            chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
            chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
            chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
            chr(8239) || chr(8287) || chr(12288) || chr(65279),
            ''
        ) <> ''
        AND translate(
            "author_provider_user_id",
            chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
            chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
            chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
            chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
            chr(8239) || chr(8287) || chr(12288) || chr(65279),
            ''
        ) <> ''
    )
);

ALTER TABLE "builds" ADD CONSTRAINT "builds_failure_summary_check"
CHECK (
    "failure_summary" IS NULL
    OR ("state" = 'failed' AND octet_length("failure_summary") BETWEEN 1 AND 1000)
);

ALTER TABLE "builds" ADD CONSTRAINT "builds_state_timestamps_check"
CHECK (
    ("started_at" IS NULL AND "finished_at" IS NULL)
    OR ("state" = 'running' AND "started_at" IS NOT NULL AND "finished_at" IS NULL)
    OR ("state" = 'superseded' AND "started_at" IS NULL AND "finished_at" IS NOT NULL)
    OR ("state" IN ('failed', 'successful') AND "started_at" IS NOT NULL AND "finished_at" IS NOT NULL)
);

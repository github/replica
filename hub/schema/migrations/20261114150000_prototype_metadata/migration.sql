-- Add the optional start page without changing existing prototypes.
ALTER TABLE "prototypes" ADD COLUMN "start_page" VARCHAR(2048);

-- Older writers could save blank draft names and descriptions.
UPDATE "prototypes"
SET "name" = NULL
WHERE "registered_at" IS NULL AND translate(
    "name",
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
    chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
    chr(8239) || chr(8287) || chr(12288) || chr(65279),
    ''
) = '';

UPDATE "prototypes"
SET "description" = NULL
WHERE translate(
    "description",
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
    chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
    chr(8239) || chr(8287) || chr(12288) || chr(65279),
    ''
) = '';

-- Every writer must represent blank optional metadata as NULL.
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_metadata_check"
CHECK (
    ("name" IS NULL OR translate(
        "name",
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279),
        ''
    ) <> '') AND
    ("description" IS NULL OR translate(
        "description",
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279),
        ''
    ) <> '')
);

-- VARCHAR counts characters, so enforce the separate UTF-8 byte limit.
ALTER TABLE "prototypes" ADD CONSTRAINT "prototypes_start_page_bytes_check"
CHECK ("start_page" IS NULL OR octet_length("start_page") <= 2048);

ALTER TABLE "github_repository_access_states"
ADD COLUMN "scoping_activated_at" TIMESTAMPTZ(3);

CREATE FUNCTION protect_github_scoping_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."scoping_activated_at" IS NOT NULL
       AND NEW."scoping_activated_at" IS DISTINCT FROM OLD."scoping_activated_at" THEN
        RAISE EXCEPTION 'GitHub repository scoping activation cannot be changed.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "github_repository_scoping_activation_protected"
BEFORE UPDATE ON "github_repository_access_states"
FOR EACH ROW EXECUTE FUNCTION protect_github_scoping_activation();

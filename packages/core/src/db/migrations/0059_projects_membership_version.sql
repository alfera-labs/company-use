-- Rename projects.roster_version -> projects.membership_version.
--
-- Why this is a migration and not an edit to 0054: 0054 has already been applied. Editing an
-- applied migration changes nothing on a database that already ran it, so the column keeps its
-- old name while the code starts reading the new one — and every test still passes, because the
-- test database is built from an empty schema on every run and never sees the old name. That is
-- exactly how this broke: the dev database had roster_version while the code expected
-- membership_version.
--
-- "roster" is a sports and military word. The product calls these people members, and the repo
-- already has workspace_membership, so membership_version is the word that was already here.
--
-- Idempotent: renames only if the old column is still present, so it is safe to re-run and safe
-- on a database created after 0054 was corrected.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'roster_version'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'membership_version'
  ) THEN
    ALTER TABLE "projects" RENAME COLUMN "roster_version" TO "membership_version";
  END IF;
END $$;

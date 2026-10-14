-- Whose own room this is.
--
-- A pointer, deliberately not a kind. No authorization code reads this column: `may_use_resource`
-- never sees it, and a personal room is an ordinary project whose membership happens to be one
-- person. It is narrowed and widened by the same grant rows as any other room, and sharing it is
-- adding a member. The column answers exactly one question -- "which room is mine" -- for the UI
-- and for the default a new chat picks.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "personal_for_user_id" text;

-- One room per person per workspace. Partial because ordinary projects all carry NULL here, and
-- an index that skips them stays the size of the member list rather than the project list.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_personal_unique"
  ON "projects" USING btree ("workspace_id","personal_for_user_id")
  WHERE "personal_for_user_id" IS NOT NULL;

-- Personal rooms leave the name-uniqueness rule.
--
-- Every personal room is called the same thing, because nobody ever reads its stored name -- the
-- sidebar renders it as the person's own row. Without this, the second person in a workspace to
-- start a chat would get a 409 from `idx_projects_name_unique` and be unable to chat at all.
--
-- Rebuilding an index destroys no rows, and the new predicate is strictly narrower, so it can
-- only ever permit names the old one permitted plus the personal ones. Ordinary projects keep
-- exactly the uniqueness they had.
DROP INDEX IF EXISTS "idx_projects_name_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_name_unique"
  ON "projects" USING btree ("workspace_id", lower("project_name"))
  WHERE "project_status" = 'active' AND "personal_for_user_id" IS NULL;

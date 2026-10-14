-- REVERSE of 0089. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0089_source_actor_member_link.sql
--
-- Then delete the 0089 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly.
DROP INDEX IF EXISTS "idx_source_actors_member_link_state";
ALTER TABLE "source_actors" DROP CONSTRAINT IF EXISTS "source_actors_member_link_state_check";
ALTER TABLE "source_actors" DROP COLUMN IF EXISTS "linked_user_id";
ALTER TABLE "source_actors" DROP COLUMN IF EXISTS "member_link_state";

-- REVERSE of 0091. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0091_brain_source_items.sql
--
-- Then delete the 0091 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. Documents keep their brain_source_id, so no document data is lost.
DROP TABLE IF EXISTS "brain_source_items";

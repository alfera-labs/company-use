-- REVERSE of 0090. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0090_brain_source_sync_cadence.sql
--
-- Then delete the 0090 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly.
ALTER TABLE "brain_sources" DROP CONSTRAINT IF EXISTS "brain_sources_sync_cadence_check";
ALTER TABLE "brain_sources" DROP COLUMN IF EXISTS "sync_cadence";

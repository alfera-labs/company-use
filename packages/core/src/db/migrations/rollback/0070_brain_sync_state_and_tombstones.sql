-- REVERSE of 0070. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0070_brain_sync_state_and_tombstones.sql
--
-- Then delete the 0070 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly.
--
-- Dropping these columns loses what every connector sync remembered: the cursors, the progress
-- blob, and which documents were found deleted. The documents themselves are untouched, and the
-- next sweep re-lists from the beginning, so the loss costs provider requests, not text.
ALTER TABLE "brain_items" DROP COLUMN IF EXISTS "last_seen_sweep_id";--> statement-breakpoint
ALTER TABLE "brain_items" DROP COLUMN IF EXISTS "deleted_time";--> statement-breakpoint
ALTER TABLE "brain_sources" DROP COLUMN IF EXISTS "sync_state";

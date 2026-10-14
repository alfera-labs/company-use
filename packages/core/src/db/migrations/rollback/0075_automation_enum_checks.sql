-- REVERSE of 0075. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0075_automation_enum_checks.sql
--
-- Then delete the 0075 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. Dropping a CHECK loses nothing: no row is touched.
ALTER TABLE "automations" DROP CONSTRAINT IF EXISTS "automations_status_check";--> statement-breakpoint
ALTER TABLE "automations" DROP CONSTRAINT IF EXISTS "automations_created_via_check";

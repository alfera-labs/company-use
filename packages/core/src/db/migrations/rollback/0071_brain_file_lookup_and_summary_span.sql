-- REVERSE of 0071. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0071_brain_file_lookup_and_summary_span.sql
--
-- Then delete the 0071 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly.
--
-- The index only costs lookup speed. The CHECK is the one to watch: a zero-width summary chunk
-- written while 0071 was applied fails the stricter constraint, so delete those rows first.
--
--   DELETE FROM brain_item_chunks WHERE revision_end_char = revision_start_char;
ALTER TABLE "brain_item_chunks" DROP CONSTRAINT IF EXISTS "brain_item_chunks_span_check";--> statement-breakpoint
ALTER TABLE "brain_item_chunks" ADD CONSTRAINT "brain_item_chunks_span_check" CHECK ("revision_end_char" > "revision_start_char");--> statement-breakpoint
DROP INDEX IF EXISTS "idx_artifacts_provider_file";

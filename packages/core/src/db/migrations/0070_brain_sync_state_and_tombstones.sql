-- What a connector sync remembers between sweeps, and how a document that went away says so.
--
-- Two ideas, one migration, because the generic sync engine needs both on its first run.
--
-- 1. sync_state is the source's own memory: a cursor per (object, scope) so the next sweep starts
--    where this one stopped, and a progress blob the source card reads while a backfill runs. It
--    is the source's, not the crawler's: a crawl that dies mid-page loses nothing a person can see.
--
-- 2. deleted_time and last_seen_sweep_id are how a deletion travels. A sweep stamps every record
--    it saw with its own id; after a COMPLETE re-list, whatever still carries an older stamp is
--    gone from the provider and gets a deleted_time. Search skips those rows. The text stays,
--    because a citation written last month must still resolve.
ALTER TABLE "brain_sources" ADD COLUMN IF NOT EXISTS "sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brain_items" ADD COLUMN IF NOT EXISTS "deleted_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brain_items" ADD COLUMN IF NOT EXISTS "last_seen_sweep_id" text;

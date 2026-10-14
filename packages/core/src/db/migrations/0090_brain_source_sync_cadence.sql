-- Memory schema step s0005: mirrors core migration 0090_brain_source_sync_cadence. Adds the
-- per-source sync_cadence column list_stale_brain_sources reads instead of a hardcoded one-hour
-- staleness window. A source that exists before this step keeps the hourly sync it had (the column
-- is added with an 'hourly' default, which fills existing rows without a rewrite). A new source
-- then defaults to 'daily'. Re-running the step changes no row.
ALTER TABLE "brain_sources" ADD COLUMN IF NOT EXISTS "sync_cadence" text NOT NULL DEFAULT 'hourly';--> statement-breakpoint
ALTER TABLE "brain_sources" ALTER COLUMN "sync_cadence" SET DEFAULT 'daily';--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'brain_sources_sync_cadence_check'
	) THEN
		ALTER TABLE "brain_sources" ADD CONSTRAINT "brain_sources_sync_cadence_check"
			CHECK ("sync_cadence" IN ('hourly', 'daily', 'weekly', 'manual'));
	END IF;
END $$;

-- Memory schema step s0006: mirrors core migration 0091_brain_source_items. One document per app
-- item, and one membership row for every source whose sync includes it. Existing documents join
-- the source that stored them; the backfill id is derived from the pair so a rerun adds nothing.
CREATE TABLE IF NOT EXISTS "brain_source_items" (
	"brain_source_item_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brain_source_id" text NOT NULL,
	"brain_item_id" text NOT NULL,
	"last_seen_sweep_id" text,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_source_items_membership" ON "brain_source_items" USING btree ("workspace_id","brain_source_id","brain_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_source_items_item" ON "brain_source_items" USING btree ("workspace_id","brain_item_id");--> statement-breakpoint
INSERT INTO "brain_source_items" ("brain_source_item_id", "workspace_id", "brain_source_id", "brain_item_id", "last_seen_sweep_id", "created_by", "last_updated_by")
SELECT 'bsitem_' || substr(md5(i."brain_source_id" || ':' || i."brain_item_id"), 1, 26), i."workspace_id", i."brain_source_id", i."brain_item_id", i."last_seen_sweep_id", 'system', 'system'
FROM "brain_items" i
JOIN "brain_sources" s ON s."brain_source_id" = i."brain_source_id" AND s."workspace_id" = i."workspace_id"
WHERE s."app_key" <> 'memory' AND i."item_kind" <> 'scope'
ON CONFLICT DO NOTHING;

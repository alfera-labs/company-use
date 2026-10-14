-- Memory schema step s0003 (data model v5): drops the old workspace-only unique indexes now that
-- the scope-aware ones from s0002 exist. DROP INDEX IF EXISTS is idempotent.
DROP INDEX IF EXISTS "idx_brain_items_slug";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_brain_item_links_edge";

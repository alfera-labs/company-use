-- coworker-migration: no-transaction
-- Memory schema step s0002 (data model v5): the scope-aware unique swaps and the partial/expression
-- indexes section 4 lists, all built CONCURRENTLY so a live table is never locked for writes. Every
-- statement is CREATE INDEX CONCURRENTLY IF NOT EXISTS, so replaying this step changes nothing. The
-- old workspace-only unique indexes are dropped later, in s0003, once these are in place.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_scope_slug"
  ON "brain_items" ("workspace_id","scope_key","slug");--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_item_links_edge_v5"
  ON "brain_item_links" ("workspace_id","from_item_id",
    (coalesce("relation","link_kind")),
    (coalesce("to_item_id","unresolved_ref")),
    (coalesce("metadata"->>'anchor', '')));--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_scope_kind_slug"
  ON "brain_items" ("workspace_id","slug") WHERE "item_kind" = 'scope';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_stale"
  ON "brain_items" ("workspace_id") WHERE "metadata" ? 'stale_since';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_pending_file_revision"
  ON "brain_items" ("workspace_id") WHERE "metadata" ? 'pending_file_revision_id';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_previous_slugs_metadata"
  ON "brain_items" USING gin ((("metadata"->'previous_slugs')));--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_scope_file_path"
  ON "brain_items" ("workspace_id","scope_key",(("metadata"->>'file_path')))
  WHERE "metadata" ? 'file_path' AND "deleted_time" IS NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_item_links_claim_text_search"
  ON "brain_item_links" USING gin ((to_tsvector('simple', "metadata"->>'claim_text')))
  WHERE "link_method" = 'claim_receipt';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_item_links_claim_subject_valid"
  ON "brain_item_links" ("workspace_id",(("metadata"->>'subject_key')),"valid_from")
  WHERE "link_method" = 'claim_receipt';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_item_links_belongs_in_proposed"
  ON "brain_item_links" ("workspace_id",(("metadata"->>'author_actor')))
  WHERE (coalesce("relation","link_kind") = 'belongs_in') AND ("metadata"->>'proposal_state' = 'proposed');--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_item_links_relation_target"
  ON "brain_item_links" ("workspace_id",(coalesce("relation","link_kind")),"to_item_id");

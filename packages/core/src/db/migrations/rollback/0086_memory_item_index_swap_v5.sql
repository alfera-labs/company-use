-- REVERSE of 0086. Not run by the migration runner; apply by hand, in reverse migration order
-- (0086, then 0085, then 0084), only while no code depends on the new scope-aware unique indexes
-- (slugs must still be workspace-unique for the old index to apply cleanly).
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0086_memory_item_index_swap_v5.sql
--
-- Then delete the 0086 entry from drizzle.__drizzle_migrations.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_items_slug"
  ON "brain_items" ("workspace_id","slug");
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_brain_item_links_edge"
  ON "brain_item_links" ("workspace_id","from_item_id","link_kind",
    (coalesce("to_item_id","unresolved_ref")));

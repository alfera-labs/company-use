-- REVERSE of 0085. Not run by the migration runner; apply by hand, after 0086's rollback has
-- restored the old indexes.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0085_memory_item_indexes_v5.sql
--
-- Then delete the 0085 entry from drizzle.__drizzle_migrations.
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_items_scope_slug";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_item_links_edge_v5";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_items_scope_kind_slug";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_items_stale";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_items_pending_file_revision";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_items_previous_slugs_metadata";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_items_scope_file_path";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_item_links_claim_text_search";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_item_links_claim_subject_valid";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_item_links_belongs_in_proposed";
DROP INDEX CONCURRENTLY IF EXISTS "idx_brain_item_links_relation_target";

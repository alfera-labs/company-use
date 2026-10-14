-- REVERSE of 0084. Not run by the migration runner; apply by hand, after 0087, 0086 and 0085's
-- rollbacks, only while no row depends on scope_key, relation, valid_from or valid_until.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0084_memory_item_columns_v5.sql
--
-- Then delete the 0084 entry from drizzle.__drizzle_migrations.
ALTER TABLE "brain_item_revisions" DROP CONSTRAINT IF EXISTS "brain_item_revisions_authored_by_check";
ALTER TABLE "brain_item_revisions" ADD CONSTRAINT "brain_item_revisions_authored_by_check" CHECK ("authored_by" IN
  ('connector','agent','human'));
ALTER TABLE "brain_item_links" DROP CONSTRAINT IF EXISTS "brain_item_links_method_check";
ALTER TABLE "brain_item_links" ADD CONSTRAINT "brain_item_links_method_check" CHECK ("link_method" IN
  ('provider_native','url_rule','exact_ref','wikilink','runtime_provenance'));
ALTER TABLE "brain_item_links" DROP CONSTRAINT IF EXISTS "brain_item_links_relation_check";
ALTER TABLE "brain_item_links" DROP COLUMN IF EXISTS "relation";
ALTER TABLE "brain_item_links" DROP COLUMN IF EXISTS "valid_from";
ALTER TABLE "brain_item_links" DROP COLUMN IF EXISTS "valid_until";
ALTER TABLE "brain_items" DROP CONSTRAINT IF EXISTS "brain_items_scope_key_check";
ALTER TABLE "brain_items" DROP COLUMN IF EXISTS "scope_key";

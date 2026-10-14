-- REVERSE of 0092. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0092_chunk_tsv_url_words.sql
--
-- Then delete the 0092 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. chunk_tsv is generated, so no data is lost.
ALTER TABLE "brain_item_chunks" DROP COLUMN IF EXISTS "chunk_tsv";
ALTER TABLE "brain_item_chunks" ADD COLUMN "chunk_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "chunk_text")) STORED;
CREATE INDEX IF NOT EXISTS "idx_brain_item_chunks_search" ON "brain_item_chunks" USING gin ("chunk_tsv");

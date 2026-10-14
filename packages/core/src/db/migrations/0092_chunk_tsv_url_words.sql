-- Memory schema step s0007: mirrors core migration 0092_chunk_tsv_url_words. The english parser
-- keeps a URL as one token, so a word inside a URL path or query was not searchable. chunk_tsv
-- now also indexes the URL parts split on / . - _ ? = & : # % + ~. Rewrites brain_item_chunks.
ALTER TABLE "brain_item_chunks" DROP COLUMN IF EXISTS "chunk_tsv";--> statement-breakpoint
ALTER TABLE "brain_item_chunks" ADD COLUMN "chunk_tsv" tsvector GENERATED ALWAYS AS (
	to_tsvector('english', "chunk_text")
	|| to_tsvector('english', regexp_replace(
		regexp_replace("chunk_text", '(\S*(?:://|www\.)\S*)|\S+', '\1', 'g'),
		'[/.\-_?=&:#%+~]+', ' ', 'g'))
) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_item_chunks_search" ON "brain_item_chunks" USING gin ("chunk_tsv");

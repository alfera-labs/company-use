-- Brain v2: what a document is CALLED, and where it lives, become searchable.
--
-- What this fixes: a workspace held three documents titled "… Course CHEM7", and
-- asking for "chem-7" returned nothing at all. Search ranked chunk text only, so a name was
-- invisible unless the body happened to repeat it — and the body of a course syllabus does
-- not repeat its own course code.
--
-- Two columns.
--
--   container_path  The folder trail the crawl walked to reach the file, relative to the
--                   folders the person picked ("Training Courses/CHEM7 Chemistry"). The
--                   crawler already knew it and threw it away. Stored, not derived: a path
--                   rebuilt at read time would need one query per document per search.
--
--   item_tsv        Generated, like chunk_tsv, and for the same reason: a written vector can
--                   disagree with the title it came from, a generated one cannot. Title
--                   carries weight A and the path plus the slug weight B, so a document
--                   NAMED for the question outranks one merely FILED under it.
--
-- Generated rather than computed per query on purpose. The alternative — to_tsvector over
-- every item in the workspace on every search — is a sequential scan that grows with the
-- corpus, on a query the agent runs several times per answer. This way the GIN index answers
-- it, and an UPDATE that renames a document or moves it rewrites the vector by itself.
ALTER TABLE "brain_items" ADD COLUMN IF NOT EXISTS "container_path" text;--> statement-breakpoint
-- The separators are opened up before the vector is built. Postgres reads "Courses/CHEM7" as
-- one file-path token, so a person asking for CHEM7 would miss the folder that is named after
-- it; splitting on the slash indexes the folder names as the words they are.
ALTER TABLE "brain_items" ADD COLUMN IF NOT EXISTS "item_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', "title"), 'A') ||
    setweight(
      to_tsvector('english', replace(coalesce("container_path", ''), '/', ' ') || ' ' || "slug"),
      'B'
    )
  ) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_items_name_search"
  ON "brain_items" USING gin ("item_tsv");

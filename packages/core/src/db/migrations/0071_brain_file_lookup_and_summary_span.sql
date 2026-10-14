-- Two small corrections the brain crawl needs, one index and one CHECK.
--
-- 1. find_ingested_file asks "have I already stored this provider file", and it asks it once per
--    file on every crawl. The question is answered from two jsonb keys, which nothing indexed, so
--    every ask was a sequential scan of the whole catalog. The expression index below is the same
--    three columns the query names, in the same order. The table is "artifacts": queries/files.ts
--    calls it `files`, and the drizzle record maps that name onto the artifacts table (0048/0049).
--
-- 2. A table's synthesized summary chunk is not a slice of the revision: it is one sentence the
--    chunker wrote about the whole file. It carried the FIRST chunk's span, so slicing the
--    revision at its offsets returned spreadsheet rows rather than the summary. It now carries an
--    empty span at offset zero, which says honestly "this passage quotes nothing", and the CHECK
--    has to allow a zero-width span for that to be storable.
CREATE INDEX IF NOT EXISTS "idx_artifacts_provider_file" ON "artifacts" (
  "workspace_id",
  ("artifact_metadata"->>'app_key'),
  ("artifact_metadata"->>'external_file_id')
);--> statement-breakpoint
ALTER TABLE "brain_item_chunks" DROP CONSTRAINT IF EXISTS "brain_item_chunks_span_check";--> statement-breakpoint
ALTER TABLE "brain_item_chunks" ADD CONSTRAINT "brain_item_chunks_span_check" CHECK ("revision_end_char" >= "revision_start_char");

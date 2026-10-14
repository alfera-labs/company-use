-- Brain v2 storage.
--
-- Five tables holding faithful copies of the documents a workspace connects, plus the
-- deterministic graph between them. Nothing here is a judgement: no summaries, no scores,
-- no model output. Ingestion writes text it was given and the offsets it can prove.
--
-- Three rules the shapes below enforce rather than describe:
--
--   Append-only.   A changed document inserts a revision and stamps the old one
--                  superseded_time. Content text is never updated in place, so a citation
--                  taken last week still resolves to the exact bytes that were quoted.
--
--   Exact spans.   A chunk carries revision_start_char/revision_end_char, and slicing the
--                  revision at those offsets returns chunk_text byte for byte. The CHECK
--                  only catches an inverted span; the chunker's test proves the rest.
--
--   Fail closed.   A link either names a real item (to_item_id) or records the reference it
--                  could not resolve (unresolved_ref) — exactly one of the two, never a
--                  guess. The CHECK is what makes a guessed edge unwritable.
--
-- The old extraction memory (items/item_chunks/memory_facts) is untouched and unrelated.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
-- A brain source is the user-facing sync object: one connected app plus the scope of it a
-- person chose to bring in. The status enums are the words the source card shows verbatim,
-- which is why they live in a CHECK and not in application code.
CREATE TABLE IF NOT EXISTS "brain_sources" (
  "brain_source_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "connection_id" text,
  "app_key" text NOT NULL,
  "source_name" text NOT NULL,
  -- What of the app to sync: {folder_ids:[], labels:[], channel_ids:[]}. Provider-shaped,
  -- so it stays jsonb instead of becoming a column per provider.
  "sync_scope" jsonb NOT NULL DEFAULT '{}',
  "sync_status" text NOT NULL DEFAULT 'never_synced',
  -- Backfill is tracked apart from status on purpose: a source can be 'connected' and
  -- searchable while its long tail is still 'backfilling'. Collapsing the two is how a
  -- half-loaded corpus gets reported as complete.
  "backfill_state" text NOT NULL DEFAULT 'unknown',
  "last_synced_time" timestamptz,
  "last_error" jsonb,
  "document_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_time" timestamptz NOT NULL DEFAULT now(),
  "last_updated_time" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL, "last_updated_by" text NOT NULL,
  CONSTRAINT "brain_sources_sync_status_check" CHECK ("sync_status" IN
    ('never_synced','syncing','connected','stalled','broken','rate_limited','paused')),
  CONSTRAINT "brain_sources_backfill_state_check" CHECK ("backfill_state" IN
    ('backfilling','quiesced','completed','unknown')),
  CONSTRAINT "brain_sources_document_count_check" CHECK ("document_count" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_sources_workspace"
  ON "brain_sources" ("workspace_id","created_time" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_sources_connection"
  ON "brain_sources" ("workspace_id","connection_id") WHERE "connection_id" IS NOT NULL;--> statement-breakpoint
-- One row per document. external_item_id is the provider's own id (a Drive file id), which
-- is both the dedupe key for re-crawls and the key the link compiler's url rules resolve
-- against, so it is unique per app inside a workspace.
CREATE TABLE IF NOT EXISTS "brain_items" (
  "brain_item_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "brain_source_id" text NOT NULL,
  "app_key" text NOT NULL,
  "external_item_id" text NOT NULL,
  "external_container_id" text,
  "title" text NOT NULL,
  -- Minted once, on create, and never re-minted: the agent cites slugs, and a slug that
  -- moves when someone renames a file turns every citation already written into a dead one.
  "slug" text NOT NULL,
  "item_kind" text NOT NULL DEFAULT 'document',
  "source_url" text,
  "current_revision_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_time" timestamptz NOT NULL DEFAULT now(),
  "last_updated_time" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL, "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_items_provider_identity"
  ON "brain_items" ("workspace_id","app_key","external_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_items_slug"
  ON "brain_items" ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_items_source"
  ON "brain_items" ("workspace_id","brain_source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_items_container"
  ON "brain_items" ("workspace_id","external_container_id") WHERE "external_container_id" IS NOT NULL;--> statement-breakpoint
-- Append-only text history. content_hash is sha256 of content_text and is what makes a
-- re-crawl of an unchanged document write nothing at all.
CREATE TABLE IF NOT EXISTS "brain_item_revisions" (
  "brain_item_revision_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "brain_item_id" text NOT NULL,
  "external_revision" text,
  "content_text" text,
  "content_hash" text NOT NULL,
  -- The original bytes, kept in the generic files service. Text is what search reads; this
  -- is what a person opens when they want to see the PDF the text came out of.
  "raw_file_id" text,
  "authored_by" text NOT NULL,
  "recorded_time" timestamptz NOT NULL DEFAULT now(),
  "superseded_time" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_time" timestamptz NOT NULL DEFAULT now(),
  "last_updated_time" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL, "last_updated_by" text NOT NULL,
  CONSTRAINT "brain_item_revisions_authored_by_check" CHECK ("authored_by" IN
    ('connector','agent','human'))
);--> statement-breakpoint
-- Partial, because a provider that has no revision concept sends NULL for every crawl and
-- a full unique index would let exactly one such revision exist per item.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_item_revisions_external"
  ON "brain_item_revisions" ("workspace_id","brain_item_id","external_revision")
  WHERE "external_revision" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_item_revisions_history"
  ON "brain_item_revisions" ("workspace_id","brain_item_id","recorded_time" DESC);--> statement-breakpoint
-- Search units, one immutable set per revision. chunk_tsv is generated rather than written
-- so a chunk can never carry a search vector that disagrees with its own text.
CREATE TABLE IF NOT EXISTS "brain_item_chunks" (
  "brain_item_chunk_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "brain_item_id" text NOT NULL,
  "brain_item_revision_id" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "chunk_kind" text NOT NULL DEFAULT 'section',
  "chunk_text" text NOT NULL,
  "revision_start_char" integer NOT NULL,
  "revision_end_char" integer NOT NULL,
  -- The two-argument to_tsvector. The one-argument form reads a runtime setting, which makes
  -- it STABLE rather than IMMUTABLE, and Postgres refuses to store it in a generated column.
  "chunk_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "chunk_text")) STORED,
  -- Nullable: the vector arm lands after the keyword arm, and a chunk with no embedding is
  -- fully searchable by keyword in the meantime.
  "chunk_embedding" halfvec(1536),
  "embedding_model_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_time" timestamptz NOT NULL DEFAULT now(),
  "last_updated_time" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL, "last_updated_by" text NOT NULL,
  CONSTRAINT "brain_item_chunks_span_check" CHECK ("revision_end_char" > "revision_start_char"),
  CONSTRAINT "brain_item_chunks_embedding_pair_check"
    CHECK (("chunk_embedding" IS NULL) = ("embedding_model_id" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_item_chunks_slice"
  ON "brain_item_chunks" ("workspace_id","brain_item_revision_id","chunk_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_item_chunks_item"
  ON "brain_item_chunks" ("workspace_id","brain_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_item_chunks_search"
  ON "brain_item_chunks" USING gin ("chunk_tsv");--> statement-breakpoint
-- The graph. Every producer is deterministic — a provider's own parent id, a URL rule, an
-- exact reference, a [[slug]] — so an edge is evidence, not an inference.
CREATE TABLE IF NOT EXISTS "brain_item_links" (
  "brain_item_link_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "from_item_id" text NOT NULL,
  "to_item_id" text,
  "unresolved_ref" text,
  "link_kind" text NOT NULL,
  "link_method" text NOT NULL,
  -- Which revision's text produced this edge. Recompiling a revision deletes its edges and
  -- writes them again, so a sentence removed from a document takes its links with it.
  "source_revision_id" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_time" timestamptz NOT NULL DEFAULT now(),
  "last_updated_time" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL, "last_updated_by" text NOT NULL,
  CONSTRAINT "brain_item_links_target_check"
    CHECK (("to_item_id" IS NULL) <> ("unresolved_ref" IS NULL)),
  CONSTRAINT "brain_item_links_kind_check" CHECK ("link_kind" IN
    ('mentions','cites','in_container','thread')),
  CONSTRAINT "brain_item_links_method_check" CHECK ("link_method" IN
    ('provider_native','url_rule','exact_ref','wikilink','runtime_provenance'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_item_links_edge"
  ON "brain_item_links" ("workspace_id","from_item_id","link_kind",
    (coalesce("to_item_id","unresolved_ref")));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_item_links_backlink"
  ON "brain_item_links" ("workspace_id","to_item_id") WHERE "to_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brain_item_links_revision"
  ON "brain_item_links" ("workspace_id","source_revision_id");

-- How far one reader has read into one thing.
--
-- Read state is not a property of the thing read. It is a property of the PAIR (reader,
-- thing). `list_sessions` filters by workspace_id alone, so every member of a workspace sees
-- every chat in their sidebar, and a column on `sessions` could only ever hold one member's
-- answer. That is the reason this is a table and not a field on the object.
--
-- Generic on purpose: the subject is named by (subject_type, subject_id), so a second surface
-- is a new value in one registry rather than a second table. Chat sessions are the first;
-- subject_type carries no CHECK constraint because the CHECKs in this schema fence closed
-- lifecycles (agent_status, auth_type) while this is an open registry.
--
-- The cursor is a POSITION, not a time. `run_messages.message_sequence` is per-session
-- monotonic behind a unique index on (session_id, message_sequence), so a position is exact:
-- it cannot be confused by two messages sharing a millisecond, by clock skew between the
-- server that wrote the row and the client reporting what it read, or by a backfill. It also
-- makes an unread COUNT one indexed range scan rather than a second concept.
--
-- No row for a subject means that reader has never opened it.
--
-- Idempotent: every statement is safe to re-run.
CREATE TABLE IF NOT EXISTS "read_markers" (
  "read_marker_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "reader_id" text NOT NULL,
  "last_read_sequence" integer NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint

-- The upsert that runs every time a subject is opened conflicts on this.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_read_markers_reader_subject_unique"
  ON "read_markers" USING btree ("workspace_id","subject_type","subject_id","reader_id");--> statement-breakpoint

-- Every marker one reader holds over one kind of subject, in a single query.
CREATE INDEX IF NOT EXISTS "idx_read_markers_workspace_reader_type"
  ON "read_markers" USING btree ("workspace_id","reader_id","subject_type");

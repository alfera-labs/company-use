-- Read markers move onto the chat they belong to, and the `read_markers` table goes away.
--
-- 0048 gave read state its own generic table on the reasoning that read state is a property of
-- the PAIR (reader, chat) and so could not be a column on `sessions`. That part is still true —
-- but a map keyed by user id holds a pair just as exactly as a row does, and `session_metadata`
-- is already a jsonb column on the row the sidebar is reading anyway. The table bought a
-- generic subject registry nothing else ever used, a second id space, and a second query on
-- every chat-list render; the map costs one key.
--
--   sessions.session_metadata.read_markers = { "<user_id>": <last_read_sequence>, ... }
--
-- The value stays a POSITION (`run_messages.message_sequence`), not a time, for the same reason
-- it was one in 0048: a per-session monotonic sequence is exact where a timestamp is not.
--
-- Idempotent: every statement is safe to re-run. The backfill is a no-op once the table is
-- gone, and `to_regclass` returning NULL is how it knows.
DO $$
BEGIN
  IF to_regclass('public.read_markers') IS NULL THEN RETURN; END IF;

  -- One statement per session rather than one per marker: `||` on the whole map merges every
  -- reader of a chat at once, so two readers of the same chat cannot overwrite each other the
  -- way successive jsonb_set calls would.
  UPDATE "sessions"
  SET "session_metadata" = "sessions"."session_metadata" || jsonb_build_object(
        'read_markers',
        COALESCE("sessions"."session_metadata" -> 'read_markers', '{}'::jsonb) || marker."readers"
      )
  FROM (
    SELECT
      "subject_id" AS "session_id",
      jsonb_object_agg("reader_id", "last_read_sequence") AS "readers"
    FROM "read_markers"
    WHERE "subject_type" = 'session'
    GROUP BY "subject_id"
  ) AS marker
  WHERE "sessions"."session_id" = marker."session_id";
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "idx_read_markers_reader_subject_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_read_markers_workspace_reader_type";--> statement-breakpoint
DROP TABLE IF EXISTS "read_markers";

-- One agent prompt lives in one column.
--
-- `agents.system_instructions` shipped in 0000. `agents.system_prompt` arrived in 0001 as a
-- rename that never finished, so for fifty migrations the table carried the same text twice.
-- Every reader already preferred `system_prompt` and fell back to `system_instructions`, and
-- every writer but one wrote both. The one exception — the imported-persona merge — wrote only
-- `system_prompt`, so an agent that imported a persona left stale text behind in
-- `system_instructions` for any API client that read that field.
--
-- This migration makes `system_prompt` the single source and stops the other column from
-- forcing writes. It does NOT drop the column: a rolling deploy keeps the previous revision
-- serving for a few minutes, and that revision SELECTs every column by name. Dropping here
-- would break it. The DROP COLUMN lands in a follow-up migration once no running build reads
-- the column.
--
-- Idempotent: the backfill is a no-op on a second run, and DROP NOT NULL is already-applied
-- safe.

-- Carry over any prompt that only ever lived in the old column. `system_prompt` defaults to ''
-- rather than NULL, so blank — not NULL — is what "never written" looks like here.
UPDATE "agents"
SET "system_prompt" = "system_instructions"
WHERE btrim("system_prompt") = ''
  AND btrim(COALESCE("system_instructions", '')) <> '';--> statement-breakpoint

-- The column is NOT NULL with no default, so an INSERT that omits it fails. Code stops writing
-- it in this same release; dropping the constraint is what lets that code insert agents at all.
ALTER TABLE "agents" ALTER COLUMN "system_instructions" DROP NOT NULL;

-- Records who wrote each session title, so nothing has to guess it from the words.
--
-- "May we replace this title?" used to be answered by matching the title text — one list of
-- known auto titles in SQL, another list plus a Slack regex in TypeScript. Two implementations
-- of one rule, and both broke the moment a title format changed. The rule is now a field:
-- session_metadata.title_generation.source. Only 'placeholder' may be replaced.
--
-- This stamps the rows that existed before the field. The text matching lives here, once, and
-- dies with this migration.
UPDATE "sessions"
SET
  "session_metadata" = jsonb_set(
    "session_metadata",
    '{title_generation}',
    '{"source":"placeholder"}'::jsonb,
    true
  )
WHERE "session_metadata" -> 'title_generation' ->> 'source' IS NULL
  AND (
    "session_title" IS NULL
    OR btrim("session_title") IN ('', 'Untitled session', 'New session', 'New chat')
    -- The Slack placeholder: `Slack C0EXAMPLE01 thread 1712000000.000200`. The suffix is the
    -- conversation scope, so the alternation must list every value resolve_slack_channel_scope
    -- returns — `group` for a multi-person DM, NOT `mpim`, which is the Slack channel_type.
    -- A row this misses keeps its channel-id title forever: there is no runtime fallback.
    OR "session_title" ~ '^Slack\s+\S+\s+(thread\s+\S+|channel|dm|group|mpim)$'
  );

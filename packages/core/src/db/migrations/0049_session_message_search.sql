-- coworker-migration: no-transaction
-- Finding a chat by something said inside it, rather than by the name on its spine.
--
-- A session title is generated from the opening prompt, so a conversation that turned into a
-- Stripe webhook debug two hours in carries a name that says nothing about the thing you now
-- want to find. The sidebar can only ever match those titles. This index is what makes the
-- message bodies searchable, which is the half of search that cannot be done in the browser:
-- message text is never shipped to the client.
--
-- CONCURRENTLY because run_messages is the largest and hottest table in the schema — every turn
-- of every run appends to it. A plain CREATE INDEX takes an ACCESS EXCLUSIVE lock and would
-- stall every send in the product for as long as the build takes.
--
-- Three deliberate narrowings. Each one must be repeated verbatim by the query, because an
-- index on an expression is only used when the query's expression is character-for-character
-- the same. A mismatch does not fail; it silently falls back to a sequential scan.
--
--   to_tsvector('english', ...)   The two-argument form. The one-argument form reads
--                                 default_text_search_config at runtime, which makes it STABLE
--                                 rather than IMMUTABLE, and Postgres refuses to index it.
--
--   left(content_text, 200000)    A tsvector is capped near 1 MB. Tool results in this table
--                                 have passed 350k characters and one reached 26 MB, so an
--                                 unbounded expression would raise on INSERT of a single wide
--                                 row and take the write down with it. 200k characters is far
--                                 past the point where a person's own words stop.
--
--   WHERE is_user_visible ...     Search reaches exactly what the reader could have read, and
--                                 the index stays off the internal status and reasoning rows,
--                                 which are the bulk of the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_run_messages_content_text_search"
  ON "run_messages"
  USING gin (to_tsvector('english', left("content_text", 200000)))
  WHERE "is_user_visible" AND "content_text" IS NOT NULL;

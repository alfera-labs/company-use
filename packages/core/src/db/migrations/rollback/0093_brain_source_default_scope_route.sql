-- REVERSE of 0093. Not run by the migration runner; apply by hand.
--
-- Back up the table first:
--
--   pg_dump "$DATABASE_URL" --data-only --table=brain_sources > brain_sources_before_0093_rollback.sql
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0093_brain_source_default_scope_route.sql
--
-- Then delete the 0093 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. The reverse also strips the default route from sources created after
-- 0093. Code from the same change reads a source without a route as the default route, so the
-- two shapes behave the same. Code before that change cannot crawl a source without a route,
-- so do not run this reverse together with a code rollback.
UPDATE "brain_sources"
SET "metadata" = "metadata" - 'scope_route'
WHERE "metadata" -> 'scope_route' = '{"route":"fixed","scope_key":"workspace"}'::jsonb;

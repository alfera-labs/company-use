-- REVERSE of 0094. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0094_team_sign_in.sql
--
-- Then delete the 0094 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. Every team-mode session and unused link is lost.
DROP TABLE IF EXISTS "team_sessions";
DROP TABLE IF EXISTS "team_sign_in_links";

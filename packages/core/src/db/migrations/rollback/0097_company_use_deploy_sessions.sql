-- REVERSE of 0097. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0097_company_use_deploy_sessions.sql
--
-- Then delete the 0097 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. The progress of every server still in setup is lost.
DROP TABLE IF EXISTS "company_use_deploy_sessions";

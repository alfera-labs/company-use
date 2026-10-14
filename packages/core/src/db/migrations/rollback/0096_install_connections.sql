-- REVERSE of 0096. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0096_install_connections.sql
--
-- Then delete the 0096 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. Every install-wide AI key is lost; the .env key stays the fallback.
DROP TABLE IF EXISTS "install_connections";

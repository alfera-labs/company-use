-- REVERSE of 0095. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0095_user_passwords.sql
--
-- Then delete the 0095 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. Every password and recovery code is lost; the owner signs in with a link.
DROP TABLE IF EXISTS "user_passwords";

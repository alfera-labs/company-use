-- REVERSE of 0088. Not run by the migration runner; apply by hand.
--
--   psql "$DATABASE_URL" -f packages/core/src/db/migrations/rollback/0088_resource_grants_memory_grantee_types.sql
--
-- Then delete the 0088 entry from drizzle.__drizzle_migrations so a later `bun run db:migrate`
-- re-applies it cleanly. Narrowing the CHECK back fails loudly if a `source_actor` or `api_key`
-- row already exists; delete those rows first if this rollback must succeed.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_grants_grantee_check') THEN
		ALTER TABLE "resource_grants" DROP CONSTRAINT "resource_grants_grantee_check";
		ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_grantee_check" CHECK ("grantee_type" IN ('project','user','agent'));
	END IF;
END $$;

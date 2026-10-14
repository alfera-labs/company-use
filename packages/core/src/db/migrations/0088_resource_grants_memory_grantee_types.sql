-- Widen resource_grants_grantee_check so a memory scope can hold `source_actor` and `api_key`
-- grantees (the memory package's scope-member sweep writes these through a host port, never a
-- link in the graph). The guard widens only the exact three-type check. A re-run on the widened
-- check is a no-op. Any other definition, or no check at all, raises and stops the migration.
--> statement-breakpoint
DO $$
DECLARE
	grantee_check_definition text;
BEGIN
	SELECT pg_get_constraintdef(oid) INTO grantee_check_definition
	FROM pg_constraint
	WHERE conname = 'resource_grants_grantee_check' AND conrelid = '"resource_grants"'::regclass;

	IF grantee_check_definition = 'CHECK ((grantee_type = ANY (ARRAY[''project''::text, ''user''::text, ''agent''::text])))' THEN
		ALTER TABLE "resource_grants" DROP CONSTRAINT "resource_grants_grantee_check";
		ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_grantee_check" CHECK ("grantee_type" IN ('project','user','agent','source_actor','api_key'));
	ELSIF grantee_check_definition = 'CHECK ((grantee_type = ANY (ARRAY[''project''::text, ''user''::text, ''agent''::text, ''source_actor''::text, ''api_key''::text])))' THEN
		RAISE NOTICE 'resource_grants_grantee_check already allows source_actor and api_key';
	ELSE
		RAISE EXCEPTION 'resource_grants_grantee_check is %, expected the project/user/agent check', coalesce(grantee_check_definition, 'absent');
	END IF;
END $$;

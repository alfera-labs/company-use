-- app_key is the stable app identity used across catalog consumers. Provider-specific identity
-- already lives in provider_key, provider_config_key, and provenance, so app_key matches app_name.
UPDATE "apps"
SET
  "app_key" = "app_name",
  "last_updated_time" = now(),
  "last_updated_by" = 'system:app_key_migration'
WHERE "app_key" <> "app_name";
--> statement-breakpoint

UPDATE "nodes" AS "node"
SET
  "app_key" = "app"."app_name",
  "last_updated_time" = now(),
  "last_updated_by" = 'system:app_key_migration'
FROM "apps" AS "app"
WHERE "node"."app_id" = "app"."app_id"
  AND "node"."app_key" <> "app"."app_name";
--> statement-breakpoint

ALTER TABLE "apps"
ADD CONSTRAINT "apps_app_key_matches_name" CHECK ("app_key" = "app_name");
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "apps" WHERE "app_key" <> "app_name"
  ) THEN
    RAISE EXCEPTION 'apps contain app_key values that do not match app_name';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "nodes" AS "node"
    JOIN "apps" AS "app" ON "app"."app_id" = "node"."app_id"
    WHERE "node"."app_key" <> "app"."app_key"
  ) THEN
    RAISE EXCEPTION 'nodes contain app_key values that do not match their app';
  END IF;
END $$;

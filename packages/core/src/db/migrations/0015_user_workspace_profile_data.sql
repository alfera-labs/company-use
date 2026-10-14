ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "user_data" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "workspace_data" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
UPDATE "users"
SET
  "first_name" = CASE
    WHEN "display_name" IS NULL OR btrim("display_name") = '' THEN NULL
    ELSE split_part(btrim("display_name"), ' ', 1)
  END,
  "last_name" = CASE
    WHEN "display_name" IS NULL OR position(' ' in btrim("display_name")) = 0 THEN NULL
    ELSE btrim(substring(btrim("display_name") from position(' ' in btrim("display_name")) + 1))
  END
WHERE "first_name" IS NULL AND "last_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "display_name";

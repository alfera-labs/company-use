-- Managed workspace email: one inbound address per workspace on the shared
-- receiving domain (INBOUND_EMAIL_DOMAIN). The username is the local part,
-- stored lowercase; the unique index is the routing key for inbound mail.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "inbound_email_username" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspaces_inbound_email_username_unique" ON "workspaces" USING btree ("inbound_email_username") WHERE "inbound_email_username" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspaces" ADD CONSTRAINT "chk_workspaces_inbound_email_username_lowercase" CHECK ("inbound_email_username" = lower("inbound_email_username"));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

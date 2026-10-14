ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "app_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_connections_credential_delivery_mode" ON "connections" (("connection_config"->>'credential_delivery_mode'));

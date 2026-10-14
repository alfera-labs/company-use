ALTER TABLE "apps" ADD COLUMN "app_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "catalog_scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "display_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "apps" SET "app_key" = "app_slug" WHERE "app_key" = '';--> statement-breakpoint
DROP INDEX IF EXISTS "idx_apps_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_apps_global_slug_unique" ON "apps" USING btree ("app_slug") WHERE "catalog_scope" = 'global' AND "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_apps_workspace_slug_unique" ON "apps" USING btree ("workspace_id","app_slug") WHERE "catalog_scope" = 'workspace';--> statement-breakpoint
CREATE INDEX "idx_apps_catalog_visibility" ON "apps" USING btree ("catalog_scope","workspace_id");--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "catalog_scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "node_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "capability_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "node_family_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "node_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "discovery_status" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "successor_node_key" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "provider_key" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "provider_config_key" text DEFAULT 'native:default' NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "provider_config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "connection_profile_key" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "connection_profile_version" integer;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "required_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "required_account_properties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "provider_node_key" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "node_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "nodes"
SET "provider_key" = CASE
  WHEN "nodes"."metadata"->>'source' IN ('native', 'mcp', 'composio', 'custom_http') THEN "nodes"."metadata"->>'source'
  WHEN "node_runtime" = 'mcp_tool' THEN 'mcp'
  ELSE 'native'
END;--> statement-breakpoint
UPDATE "nodes"
SET
  "provider_config_key" = CASE
    WHEN "provider_key" = 'mcp' THEN 'mcp:' || "apps"."app_slug" || ':first_party'
    ELSE "provider_key" || ':' || "apps"."app_slug"
  END,
  "connection_profile_key" = NULL,
  "connection_profile_version" = NULL,
  "node_key" = "provider_key" || ':' || "apps"."app_slug" || '/' || "nodes"."node_slug" || '@1',
  "capability_key" = "apps"."app_slug" || '/' || "nodes"."node_slug",
  "node_family_key" = "provider_key" || ':' || "apps"."app_slug" || '/' || "nodes"."node_slug",
  "provider_node_key" = COALESCE("nodes"."metadata"->>'provider_component_key', "nodes"."runtime_handler")
FROM "apps"
WHERE "nodes"."app_id" = "apps"."app_id";--> statement-breakpoint
CREATE INDEX "idx_nodes_key" ON "nodes" USING btree ("node_key");--> statement-breakpoint
CREATE INDEX "idx_nodes_catalog_visibility" ON "nodes" USING btree ("catalog_scope","workspace_id");--> statement-breakpoint
CREATE INDEX "idx_nodes_provider_profile" ON "nodes" USING btree ("provider_key","provider_config_key","provider_config_version","connection_profile_key","connection_profile_version");--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connection_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "provider_key" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "provider_config_key" text DEFAULT 'native:default' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "provider_config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connection_profile_key" text DEFAULT 'native:default' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connection_profile_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "auth_method_key" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "external_user_key" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "authorized_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connected_by" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connected_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_checked_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_provider_update_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "revoked_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connection_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "setup_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "provider_account" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "connections"
SET "connection_status" = 'pending_setup'
WHERE "connection_status" = 'pending';--> statement-breakpoint
UPDATE "connections"
SET "provider_key" = CASE
  WHEN "connections"."metadata"->>'provider' IN ('native', 'mcp', 'composio', 'custom_http') THEN "connections"."metadata"->>'provider'
  WHEN "credentials"->>'_credential_source' IN ('native', 'mcp', 'composio', 'custom_http') THEN "credentials"->>'_credential_source'
  ELSE 'native'
END;--> statement-breakpoint
UPDATE "connections"
SET
  "provider_config_key" = CASE
    WHEN "provider_key" = 'mcp' THEN 'mcp:' || "apps"."app_slug" || ':remote_oauth'
    ELSE "provider_key" || ':' || "apps"."app_slug"
  END,
  "connection_profile_key" = CASE
    WHEN "provider_key" = 'mcp' THEN 'mcp:' || "apps"."app_slug" || ':remote_oauth'
    ELSE "provider_key" || ':' || "apps"."app_slug" || ':default'
  END,
  "auth_method_key" = CASE
    WHEN "provider_key" = 'mcp' THEN 'mcp_remote_oauth'
    ELSE 'none'
  END,
  "connection_key" = "provider_key" || ':' || "apps"."app_slug" || ':' || "connections"."connection_id",
  "external_user_key" = COALESCE("connections"."metadata"->>'external_user_id', 'ws_' || "connections"."workspace_id"),
  "health_status" = CASE WHEN "connection_status" = 'active' THEN 'healthy' ELSE 'unknown' END,
  "connected_time" = CASE WHEN "connection_status" = 'active' THEN "connections"."created_time" ELSE NULL END,
  "connected_by" = CASE WHEN "connection_status" = 'active' THEN "connections"."created_by" ELSE NULL END,
  "provider_account" = '{}'::jsonb
FROM "apps"
WHERE "connections"."app_id" = "apps"."app_id";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connections_workspace_key_unique" ON "connections" USING btree ("workspace_id","connection_key");--> statement-breakpoint
CREATE INDEX "idx_connections_provider_profile" ON "connections" USING btree ("workspace_id","provider_key","provider_config_key","provider_config_version","connection_profile_key","connection_profile_version");

-- coworker-migration: no-transaction
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_apps_global_name_unique"
  ON "apps" ("app_name")
  WHERE "catalog_scope" = 'global' AND "workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_apps_workspace_name_unique"
  ON "apps" ("workspace_id", "app_name")
  WHERE "catalog_scope" = 'workspace';
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_nodes_app_name_unique"
  ON "nodes" ("app_id", "node_name");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_nodes_global_key_unique"
  ON "nodes" ("node_key")
  WHERE "catalog_scope" = 'global' AND "workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_nodes_workspace_key_unique"
  ON "nodes" ("workspace_id", "node_key")
  WHERE "catalog_scope" = 'workspace';

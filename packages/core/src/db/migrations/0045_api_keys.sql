-- Workspace-scoped machine credentials for the public brain API (REST + MCP).
-- Secrets are sha256-hashed at rest; lifecycle lives in timestamps.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "api_key_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_name" text NOT NULL,
  "scopes" text[] NOT NULL,
  "key_audience" text NOT NULL DEFAULT 'internal',
  "last_used_time" timestamp with time zone,
  "expires_time" timestamp with time zone,
  "revoked_time" timestamp with time zone,
  "rate_window_start_time" timestamp with time zone,
  "rate_window_request_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_time" timestamp with time zone NOT NULL DEFAULT now(),
  "last_updated_time" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_keys_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_workspace" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
-- The rate counter is two columns on "api_keys" above, not a table: it resets
-- every window and dies with its key, so it has no lifecycle of its own. The
-- next three statements only converge environments that ran an earlier version
-- of this file (which created an api_key_request_windows table); everywhere
-- else, including prod, all three are no-ops.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rate_window_start_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rate_window_request_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint
DROP TABLE IF EXISTS "api_key_request_windows";--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "api_key_id" text;

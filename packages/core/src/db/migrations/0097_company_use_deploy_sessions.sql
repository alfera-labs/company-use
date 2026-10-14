-- The deploy page makes a server in the person's own cloud account. The new server reports its
-- setup progress here until setup ends. A row holds the SHA-256 of the report token, never the
-- token, and the progress lines live and die with the row. A row expires 1 hour after it is made,
-- or 7 days after the server's first report.
-- One new, empty table: no existing row changes.
CREATE TABLE IF NOT EXISTS "company_use_deploy_sessions" (
	"install_id" text PRIMARY KEY NOT NULL,
	"report_token_hash" text NOT NULL,
	"cloud" text NOT NULL,
	"progress_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_time" timestamp with time zone NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "chk_company_use_deploy_sessions_cloud" CHECK ("cloud" IN ('digitalocean', 'aws'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_company_use_deploy_sessions_expires"
	ON "company_use_deploy_sessions" ("expires_time");

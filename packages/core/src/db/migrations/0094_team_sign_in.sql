-- Team mode (COWORKER_AUTH_MODE=team) signs people in with one-time links the install makes
-- itself. A link and a session are each a random secret; only the SHA-256 of the secret is
-- stored, and the hash is the key. Two new, empty tables: no existing row changes.
CREATE TABLE IF NOT EXISTS "team_sign_in_links" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_time" timestamp with time zone NOT NULL,
	"used_time" timestamp with time zone,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_team_sign_in_links_user"
	ON "team_sign_in_links" ("workspace_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_sessions" (
	"session_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_time" timestamp with time zone NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_team_sessions_user"
	ON "team_sessions" ("workspace_id", "user_id");

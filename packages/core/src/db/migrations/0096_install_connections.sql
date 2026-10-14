-- Connections that belong to the whole install, not to one workspace: the AI key the owner pastes
-- on the setup page is the default for every workspace on the server. Values are sealed with the
-- credential envelope, as the values of a workspace connection are. One new, empty table: no
-- existing row changes.
CREATE TABLE IF NOT EXISTS "install_connections" (
	"connection_key" text PRIMARY KEY NOT NULL,
	"connection_status" text NOT NULL,
	"credentials" jsonb NOT NULL,
	"connection_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_time" timestamp with time zone,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "chk_install_connections_status" CHECK ("connection_status" IN ('active', 'invalid'))
);

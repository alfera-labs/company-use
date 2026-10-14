-- An install that runs its own sign-in (COWORKER_AUTH_MODE=team) lets its owner sign in with an
-- email and a password. Only hashes are stored: the password as an argon2id string, the recovery
-- code as its SHA-256. One new, empty table: no existing row changes.
CREATE TABLE IF NOT EXISTS "user_passwords" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"recovery_code_hash" text NOT NULL,
	"password_set_time" timestamp with time zone NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);

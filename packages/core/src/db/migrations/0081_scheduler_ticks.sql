-- One row per named clock tick. Every worker process runs the minute tick on its own timer; the
-- first to move last_tick_time forward to the current minute runs that minute, the others skip.
-- A new, empty table: no existing row changes.
CREATE TABLE IF NOT EXISTS "scheduler_ticks" (
	"tick_name" text PRIMARY KEY NOT NULL,
	"last_tick_time" timestamp with time zone NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);

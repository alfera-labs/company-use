-- The nightly canary's ledger.
--
-- A native connector fails silently in the worst way: the provider changed a field, every node
-- of that app starts returning invalid_provider_response, and nobody hears about it until a
-- customer's run breaks. The sweep calls each allow-listed app's cheapest read once a day and
-- appends what happened here, so a regression is visible before a person reports it.
--
-- Append-only by design. A row is an observation, not a status: the latest row per app_key IS
-- the current health, and the ones behind it are the history that says when it broke.
CREATE TABLE IF NOT EXISTS "connector_health" (
  "connector_health_id" text PRIMARY KEY NOT NULL,
  "app_key" text NOT NULL,
  "node_key" text NOT NULL,
  "checked_time" timestamp with time zone DEFAULT now() NOT NULL,
  "ok" boolean NOT NULL,
  "latency_ms" integer NOT NULL,
  "error_code" text,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL,
  CONSTRAINT "connector_health_latency_ms_check" CHECK ("latency_ms" >= 0),
  -- A failed probe must name its failure, and a healthy one must not invent one.
  CONSTRAINT "connector_health_error_code_check" CHECK (
    ("ok" AND "error_code" IS NULL) OR (NOT "ok" AND "error_code" IS NOT NULL)
  )
);--> statement-breakpoint
-- The one question asked of this table: how has this app looked lately.
CREATE INDEX IF NOT EXISTS "idx_connector_health_app_checked"
  ON "connector_health" ("app_key", "checked_time");

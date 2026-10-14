ALTER TABLE "run_messages" RENAME COLUMN "is_visible_to_user" TO "is_user_visible";--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "is_model_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "provider_item_id" text;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "provider_call_id" text;--> statement-breakpoint
ALTER TABLE "run_messages" ADD COLUMN "run_message_sequence" integer;--> statement-breakpoint
INSERT INTO "runs" (
  "run_id",
  "workspace_id",
  "session_id",
  "agent_id",
  "run_status",
  "trigger_type",
  "run_reason",
  "started_time",
  "completed_time",
  "finished_time",
  "created_time",
  "last_updated_time",
  "created_by",
  "last_updated_by"
)
SELECT
  'run_legacy_' || rm."session_id",
  rm."workspace_id",
  rm."session_id",
  s."agent_id",
  'completed',
  'api',
  'system',
  MIN(rm."created_time"),
  MAX(rm."last_updated_time"),
  MAX(rm."last_updated_time"),
  MIN(rm."created_time"),
  MAX(rm."last_updated_time"),
  MIN(rm."created_by"),
  MAX(rm."last_updated_by")
FROM "run_messages" rm
INNER JOIN "sessions" s ON s."session_id" = rm."session_id"
WHERE rm."run_id" IS NULL
GROUP BY rm."workspace_id", rm."session_id", s."agent_id"
ON CONFLICT ("run_id") DO NOTHING;--> statement-breakpoint
UPDATE "run_messages"
SET "run_id" = 'run_legacy_' || "session_id"
WHERE "run_id" IS NULL;--> statement-breakpoint
WITH ranked_messages AS (
  SELECT
    "run_message_id",
    ROW_NUMBER() OVER (
      PARTITION BY "run_id"
      ORDER BY "message_sequence", "created_time", "run_message_id"
    ) AS "next_run_message_sequence"
  FROM "run_messages"
)
UPDATE "run_messages" rm
SET "run_message_sequence" = ranked_messages."next_run_message_sequence"
FROM ranked_messages
WHERE rm."run_message_id" = ranked_messages."run_message_id";--> statement-breakpoint
ALTER TABLE "run_messages" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_messages" ALTER COLUMN "run_message_sequence" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_run_messages_run_sequence_unique" ON "run_messages" USING btree ("run_id","run_message_sequence");--> statement-breakpoint
ALTER TABLE "run_events" RENAME COLUMN "event_payload" TO "event_data";--> statement-breakpoint
ALTER TABLE "tool_calls" RENAME COLUMN "input_json" TO "input_data";--> statement-breakpoint
ALTER TABLE "tool_calls" RENAME COLUMN "output_json" TO "output_data";--> statement-breakpoint
ALTER TABLE "tool_calls" RENAME COLUMN "tool_metadata" TO "tool_call_metadata";--> statement-breakpoint
ALTER TABLE "tool_calls" DROP COLUMN "input";--> statement-breakpoint
ALTER TABLE "tool_calls" DROP COLUMN "output";--> statement-breakpoint
CREATE TABLE "approval_requests" (
  "approval_request_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "session_id" text NOT NULL,
  "run_id" text NOT NULL,
  "tool_call_id" text NOT NULL,
  "approval_status" text DEFAULT 'pending' NOT NULL,
  "approval_reason" text,
  "requested_action" text NOT NULL,
  "request_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_by" text,
  "requested_time" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_time" timestamp with time zone,
  "approval_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL,
  CONSTRAINT "approval_requests_status_check" CHECK (approval_status IN ('pending', 'approved', 'denied', 'expired', 'cancelled'))
);--> statement-breakpoint
CREATE TABLE "approval_decisions" (
  "approval_decision_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "session_id" text NOT NULL,
  "run_id" text NOT NULL,
  "approval_request_id" text NOT NULL,
  "tool_call_id" text NOT NULL,
  "decision_status" text NOT NULL,
  "decision_reason" text,
  "decision_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "decided_by" text NOT NULL,
  "decided_time" timestamp with time zone DEFAULT now() NOT NULL,
  "decision_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL,
  CONSTRAINT "approval_decisions_status_check" CHECK (decision_status IN ('approved', 'denied', 'cancelled'))
);--> statement-breakpoint
CREATE INDEX "idx_approval_requests_tool_call" ON "approval_requests" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_run" ON "approval_requests" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_workspace_status_created" ON "approval_requests" USING btree ("workspace_id","approval_status","created_time");--> statement-breakpoint
CREATE INDEX "idx_approval_decisions_request" ON "approval_decisions" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "idx_approval_decisions_tool_call" ON "approval_decisions" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "idx_approval_decisions_run" ON "approval_decisions" USING btree ("run_id");

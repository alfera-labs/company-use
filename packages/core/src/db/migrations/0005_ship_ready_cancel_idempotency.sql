-- DB-backed cancel intent (survives across workers/processes).
-- run_status only flips to 'cancelled' at terminus; the run loop polls
-- cancel_requested_time to abort mid-flight tool calls.
ALTER TABLE "runs" ADD COLUMN "cancel_requested_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_by" text;--> statement-breakpoint
CREATE INDEX "idx_runs_cancel_requested" ON "runs" USING btree ("cancel_requested_time") WHERE "cancel_requested_time" IS NOT NULL;--> statement-breakpoint

-- Idempotency key for tool calls that cross a network boundary (Modal).
-- Server-side dedup is keyed on (workspace_id, tool_call_id) but we plumb
-- an explicit idempotency_key column so the contract is visible.
ALTER TABLE "tool_calls" ADD COLUMN "idempotency_key" text;

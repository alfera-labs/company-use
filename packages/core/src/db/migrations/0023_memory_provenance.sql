-- Memory context integrity: provenance columns + kind index + one-time poison archive.
-- Hand-written idempotent SQL
-- (drizzle-kit generate is not used in this repo).

ALTER TABLE "memory_facts" ADD COLUMN IF NOT EXISTS "origin" text NOT NULL DEFAULT 'agent_inferred';
--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN IF NOT EXISTS "initiated_by" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_facts_workspace_kind"
  ON "memory_facts" ("workspace_id", "fact_kind")
  WHERE "memory_status" = 'active';
--> statement-breakpoint
-- Backfill epistemic status for rows written before this column existed.
UPDATE "memory_facts" SET "origin" = 'agent_action'
  WHERE "fact_kind" = 'action' AND "origin" = 'agent_inferred';
--> statement-breakpoint
UPDATE "memory_facts" SET "origin" = 'ingested'
  WHERE "fact_kind" IN ('channel_digest', 'roster') AND "origin" = 'agent_inferred';
--> statement-breakpoint
UPDATE "memory_facts" SET "origin" = 'system'
  WHERE "fact_kind" IN ('workspace_profile', 'workflow_proposal') AND "origin" = 'agent_inferred';
--> statement-breakpoint
UPDATE "memory_facts" SET "initiated_by" = 'agent'
  WHERE "fact_kind" = 'action' AND "initiated_by" IS NULL;
--> statement-breakpoint
-- One-time quarantine of existing episodic poison: action transcripts were stored as facts with
-- raw target ids in their text. They are no longer read on the prompt-push path, but archive the
-- historical rows so they cannot surface through any legacy read either. Archive, not delete:
-- recall_agent_activity reads archived rows for "did I already do this?" history.
UPDATE "memory_facts" SET "memory_status" = 'archived'
  WHERE "fact_kind" = 'action' AND "memory_status" = 'active';

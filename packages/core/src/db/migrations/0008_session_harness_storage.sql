ALTER TABLE "sessions" ADD COLUMN "active_leaf_entry_id" text;--> statement-breakpoint
CREATE INDEX "idx_sessions_active_leaf" ON "sessions" USING btree ("workspace_id","active_leaf_entry_id");--> statement-breakpoint
CREATE TABLE "session_tree_entries" (
  "session_tree_entry_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "session_id" text NOT NULL,
  "parent_entry_id" text,
  "entry_type" text NOT NULL,
  "entry_sequence" integer NOT NULL,
  "entry_data" jsonb NOT NULL,
  "source_run_id" text,
  "source_run_message_id" text,
  "actor_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_tree_entries_session_sequence_unique" ON "session_tree_entries" USING btree ("session_id","entry_sequence");--> statement-breakpoint
CREATE INDEX "idx_session_tree_entries_session_time" ON "session_tree_entries" USING btree ("workspace_id","session_id","created_time");--> statement-breakpoint
CREATE INDEX "idx_session_tree_entries_parent" ON "session_tree_entries" USING btree ("workspace_id","session_id","parent_entry_id");--> statement-breakpoint
CREATE INDEX "idx_session_tree_entries_source_message" ON "session_tree_entries" USING btree ("source_run_message_id");--> statement-breakpoint
CREATE TABLE "session_context_operations" (
  "session_context_operation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "session_id" text NOT NULL,
  "run_id" text,
  "operation_type" text NOT NULL,
  "operation_sequence" integer NOT NULL,
  "target_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "operation_data" jsonb NOT NULL,
  "operation_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_context_operations_session_sequence_unique" ON "session_context_operations" USING btree ("session_id","operation_sequence");--> statement-breakpoint
CREATE INDEX "idx_session_context_operations_session_time" ON "session_context_operations" USING btree ("workspace_id","session_id","created_time");--> statement-breakpoint
CREATE INDEX "idx_session_context_operations_run" ON "session_context_operations" USING btree ("run_id");

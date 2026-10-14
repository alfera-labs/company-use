CREATE TABLE "channels" (
  "channel_id" text PRIMARY KEY NOT NULL,
  "channel_key" text NOT NULL,
  "workspace_id" text NOT NULL,
  "connection_id" text,
  "channel_provider_key" text NOT NULL,
  "channel_name" text,
  "channel_status" text DEFAULT 'enabled' NOT NULL,
  "external_account_id" text,
  "external_conversation_id" text,
  "external_thread_id" text,
  "conversation_scope" text DEFAULT 'any' NOT NULL,
  "routing_priority" integer DEFAULT 0 NOT NULL,
  "target_kind" text DEFAULT 'agent' NOT NULL,
  "target_id" text NOT NULL,
  "channel_source" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "channel_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "channel_target" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_channels_workspace_key_unique" ON "channels" USING btree ("workspace_id","channel_key");--> statement-breakpoint
CREATE INDEX "idx_channels_workspace_target" ON "channels" USING btree ("workspace_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "idx_channels_lookup" ON "channels" USING btree ("workspace_id","channel_provider_key","connection_id","channel_status","external_account_id","external_conversation_id","conversation_scope","target_kind","target_id");--> statement-breakpoint

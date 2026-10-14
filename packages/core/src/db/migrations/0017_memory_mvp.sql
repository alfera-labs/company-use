CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "source_actors" (
	"source_actor_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_kind" text DEFAULT 'platform_user' NOT NULL,
	"provider" text,
	"external_id" text,
	"display_name" text,
	"email" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_facts" (
	"memory_fact_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_ref_kind" text DEFAULT 'concept' NOT NULL,
	"subject_source_actor_id" text,
	"subject_label" text NOT NULL,
	"subject_entity_id" text,
	"visibility" text DEFAULT 'workspace_shared' NOT NULL,
	"owner_actor_id" text,
	"predicate" text,
	"object_text" text,
	"object_entity_id" text,
	"fact_text" text NOT NULL,
	"fact_kind" text DEFAULT 'observation' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_time" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by_fact_id" text,
	"confidence_level" real DEFAULT 0.7 NOT NULL,
	"importance_score" integer DEFAULT 5 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"source_trust_tier" text DEFAULT 'normal' NOT NULL,
	"source_session_id" text,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_status" text DEFAULT 'proposed' NOT NULL,
	"expires_time" timestamp with time zone,
	"content_hash" text NOT NULL,
	"fact_embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_actors_provider_identity" ON "source_actors" USING btree ("workspace_id","provider","external_id") WHERE "source_actors"."provider" IS NOT NULL AND "source_actors"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_source_actors_workspace" ON "source_actors" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memory_facts_active_claim" ON "memory_facts" USING btree ("workspace_id","subject_label","predicate","object_text") WHERE "memory_facts"."memory_status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_memory_facts_subject_active" ON "memory_facts" USING btree ("workspace_id","subject_label") WHERE "memory_facts"."memory_status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_memory_facts_workspace_status" ON "memory_facts" USING btree ("workspace_id","memory_status");--> statement-breakpoint
CREATE INDEX "idx_memory_facts_pinned" ON "memory_facts" USING btree ("workspace_id") WHERE "memory_facts"."pinned" = true AND "memory_facts"."memory_status" = 'active';

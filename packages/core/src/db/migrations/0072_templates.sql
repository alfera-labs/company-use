CREATE TABLE IF NOT EXISTS "templates" (
	"template_id" text PRIMARY KEY NOT NULL,
	"template_slug" text NOT NULL,
	"template_kind" text NOT NULL,
	"catalog_scope" text DEFAULT 'workspace' NOT NULL,
	"workspace_id" text,
	"publisher_handle" text NOT NULL,
	"publisher_kind" text DEFAULT 'user' NOT NULL,
	"publisher_display_name" text NOT NULL,
	"publisher_avatar_url" text,
	"template_name" text NOT NULL,
	"summary_text" text DEFAULT '' NOT NULL,
	"readme_markdown" text DEFAULT '' NOT NULL,
	"model_facing_description" text DEFAULT '' NOT NULL,
	"cover_image_url" text,
	"template_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_schema_version" integer DEFAULT 1 NOT NULL,
	"setup_input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"listing_status" text DEFAULT 'draft' NOT NULL,
	"discovery_status" text DEFAULT 'visible' NOT NULL,
	"submitted_time" timestamp with time zone,
	"published_time" timestamp with time zone,
	"review_notes" text,
	"price_kind" text DEFAULT 'free' NOT NULL,
	"forked_from_template_id" text,
	"category_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("template_name", '') || ' ' || coalesce("summary_text", ''))) STORED,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "templates_catalog_scope_check" CHECK ("catalog_scope" IN ('global', 'workspace')),
	CONSTRAINT "templates_catalog_scope_workspace_check" CHECK (
		("catalog_scope" = 'global' AND "workspace_id" IS NULL)
		OR ("catalog_scope" = 'workspace' AND "workspace_id" IS NOT NULL)
	),
	CONSTRAINT "templates_listing_status_check" CHECK ("listing_status" IN ('draft', 'in_review', 'changes_requested', 'published', 'suspended', 'archived')),
	CONSTRAINT "templates_discovery_status_check" CHECK ("discovery_status" IN ('visible', 'unlisted')),
	CONSTRAINT "templates_publisher_kind_check" CHECK ("publisher_kind" IN ('user', 'workspace', 'platform')),
	CONSTRAINT "templates_published_needs_time_check" CHECK ("listing_status" <> 'published' OR "published_time" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_templates_global_slug_unique" ON "templates" USING btree ("template_slug") WHERE "catalog_scope" = 'global' AND "workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_templates_workspace_slug_unique" ON "templates" USING btree ("workspace_id","template_slug") WHERE "catalog_scope" = 'workspace';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_public_feed" ON "templates" USING btree ("published_time" DESC) WHERE "catalog_scope" = 'global' AND "listing_status" = 'published' AND "discovery_status" = 'visible';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_kind_feed" ON "templates" USING btree ("template_kind","published_time" DESC) WHERE "listing_status" = 'published';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_publisher" ON "templates" USING btree ("publisher_handle","listing_status","published_time" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_catalog_visibility" ON "templates" USING btree ("catalog_scope","workspace_id","listing_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_review_queue" ON "templates" USING btree ("submitted_time") WHERE "listing_status" = 'in_review';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_search" ON "templates" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_requirements" ON "templates" USING gin ("requirements" jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_categories" ON "templates" USING gin ("category_slugs" jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_tags" ON "templates" USING gin ("tags" jsonb_path_ops);
--> statement-breakpoint
-- The templates columns that arrived with the retired install migration: the kind check,
-- the readiness state, and the facets browse axis. All idempotent, all templates-only.
--> statement-breakpoint
-- template_kind was the only closed-set column on `templates` without a check.
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'templates_kind_check') THEN
		ALTER TABLE "templates" ADD CONSTRAINT "templates_kind_check" CHECK ("template_kind" IN ('task', 'skill', 'role'));
	END IF;
END $$;
--> statement-breakpoint
-- 'ready' means a stranger can switch it on unaided; 'built_with_you' means it needs a build.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "listing_state" text DEFAULT 'built_with_you' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'templates_listing_state_check') THEN
		ALTER TABLE "templates" ADD CONSTRAINT "templates_listing_state_check" CHECK ("listing_state" IN ('ready', 'built_with_you'));
	END IF;
END $$;
--> statement-breakpoint
-- One shape and one GIN pattern for every browse axis: category, role, app.
-- `category_slugs` stays until nothing reads it.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "facets" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_facets" ON "templates" USING gin ("facets" jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_state" ON "templates" USING btree ("listing_state","published_time" DESC) WHERE "listing_status" = 'published';
--> statement-breakpoint

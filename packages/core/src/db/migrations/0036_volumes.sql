CREATE TABLE "volumes" (
	"volume_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"volume_provider" text NOT NULL,
	"volume_status" text DEFAULT 'provisioning' NOT NULL,
	"provider_volume_id" text,
	"provider_region" text,
	"encrypted_mount_credentials" jsonb,
	"lease_run_id" text,
	"lease_expires_time" timestamp with time zone,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"last_synced_time" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL,
	CONSTRAINT "volumes_provider_check" CHECK ("volume_provider" IN ('archil')),
	CONSTRAINT "volumes_status_check" CHECK ("volume_status" IN ('provisioning', 'retryable', 'active', 'unhealthy')),
	CONSTRAINT "volumes_lease_pair_check" CHECK (("lease_run_id" IS NULL) = ("lease_expires_time" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_volumes_workspace_unique" ON "volumes" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_volumes_provider_id_unique" ON "volumes" USING btree ("volume_provider","provider_volume_id");

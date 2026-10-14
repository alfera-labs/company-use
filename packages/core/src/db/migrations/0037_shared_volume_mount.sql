ALTER TABLE "volumes" DROP CONSTRAINT IF EXISTS "volumes_lease_pair_check";--> statement-breakpoint
ALTER TABLE "volumes" DROP COLUMN IF EXISTS "lease_run_id";--> statement-breakpoint
ALTER TABLE "volumes" DROP COLUMN IF EXISTS "lease_expires_time";--> statement-breakpoint
ALTER TABLE "volumes" DROP COLUMN IF EXISTS "lease_generation";

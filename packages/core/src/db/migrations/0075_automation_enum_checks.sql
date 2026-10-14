-- The two closed-set columns on `automations` that arrived in 0073 without a check. Both idempotent.
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automations_status_check') THEN
		ALTER TABLE "automations" ADD CONSTRAINT "automations_status_check" CHECK ("automation_status" IN ('enabled', 'paused', 'error', 'archived'));
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automations_created_via_check') THEN
		ALTER TABLE "automations" ADD CONSTRAINT "automations_created_via_check" CHECK ("created_via" IN ('user', 'agent_tool', 'api', 'automation_miner', 'system'));
	END IF;
END $$;

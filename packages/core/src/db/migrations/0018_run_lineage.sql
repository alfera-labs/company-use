ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "parent_run_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "root_run_id" text;--> statement-breakpoint
UPDATE "runs" SET "root_run_id" = "run_id" WHERE "root_run_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_root" ON "runs" USING btree ("workspace_id","root_run_id");

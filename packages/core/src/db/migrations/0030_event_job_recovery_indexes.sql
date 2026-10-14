-- coworker-migration: no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_jobs_global_ready" ON "event_jobs" ("available_time","created_time","job_id","workspace_id","subject_key") WHERE "job_status" = 'queued';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_jobs_ready_subjects" ON "event_jobs" ("workspace_id","subject_key","available_time","created_time","job_id") WHERE "job_status" = 'queued';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_event_jobs_expired_lock" ON "event_jobs" ("locked_until","job_id") WHERE "job_status" = 'running';

CREATE INDEX IF NOT EXISTS "idx_connections_pending_setup_expiry"
ON "connections" USING btree ("created_time")
WHERE "connection_status" = 'pending_setup';

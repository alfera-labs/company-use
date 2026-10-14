-- "What did key K spend" is a hot query for the public brain API,
-- and memory_read_usage writes one usage row per read request — so without this index the
-- highest-volume table is a sequential scan. Partial: only key-authorized usage carries an
-- api_key_id, which is a small slice of all usage.
CREATE INDEX IF NOT EXISTS "idx_usage_records_api_key_date" ON "usage_records" USING btree ("api_key_id","created_time") WHERE "api_key_id" IS NOT NULL;

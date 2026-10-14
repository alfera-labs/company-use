-- Memory predicate policies need scope-aware active claims. Keep the DB backstop on an explicit
-- scope_identity column; content_hash is content provenance, not a uniqueness key.

ALTER TABLE "memory_facts" ADD COLUMN IF NOT EXISTS "scope_identity" text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN IF NOT EXISTS "object_identity" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN IF NOT EXISTS "embedding_model_id" text;
--> statement-breakpoint
UPDATE "memory_facts"
  SET "object_identity" = lower(regexp_replace(trim(COALESCE("object_text", '')), '[[:space:]]+', '_', 'g'))
  WHERE "object_identity" = '';
--> statement-breakpoint
UPDATE "memory_facts" AS fact
  SET "scope_identity" = COALESCE(
    (
      SELECT '{' || string_agg(
        to_json("scope_key")::text || ':' || to_json("scope_value")::text,
        ',' ORDER BY "scope_key"
      ) || '}'
      FROM (
        SELECT
          lower(regexp_replace(trim(scope_entry.key), '[[:space:]]+', '_', 'g')) AS "scope_key",
          lower(regexp_replace(trim(scope_entry.value), '[[:space:]]+', '_', 'g')) AS "scope_value"
        FROM jsonb_each_text(
          CASE
            WHEN jsonb_typeof(fact."metadata"->'scope') = 'object' THEN fact."metadata"->'scope'
            ELSE '{}'::jsonb
          END
        ) AS scope_entry(key, value)
        WHERE trim(scope_entry.key) <> '' AND trim(scope_entry.value) <> ''
      ) AS normalized_scope
    ),
    '{}'
  )
  WHERE "scope_identity" = '{}';
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_memory_facts_active_claim";
--> statement-breakpoint
WITH ranked_duplicates AS (
  SELECT
    "memory_fact_id",
    first_value("memory_fact_id") OVER (
      PARTITION BY "workspace_id", "subject_label", "predicate", "object_identity", "scope_identity"
      ORDER BY "recorded_time" DESC, "created_time" DESC, "memory_fact_id" DESC
    ) AS survivor_fact_id,
    row_number() OVER (
      PARTITION BY "workspace_id", "subject_label", "predicate", "object_identity", "scope_identity"
      ORDER BY "recorded_time" DESC, "created_time" DESC, "memory_fact_id" DESC
    ) AS duplicate_rank
  FROM "memory_facts"
  WHERE "memory_status" = 'active'
)
UPDATE "memory_facts"
  SET
    "memory_status" = 'superseded',
    "valid_to" = now(),
    "superseded_by_fact_id" = ranked_duplicates.survivor_fact_id,
    "last_updated_time" = now(),
    "last_updated_by" = 'migration'
  FROM ranked_duplicates
  WHERE "memory_facts"."memory_fact_id" = ranked_duplicates."memory_fact_id"
    AND ranked_duplicates.duplicate_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_memory_facts_active_claim"
  ON "memory_facts" ("workspace_id", "subject_label", "predicate", "object_identity", "scope_identity")
  WHERE "memory_status" = 'active';

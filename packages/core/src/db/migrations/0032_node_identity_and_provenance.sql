-- Node and app identity + provenance cleanup.
--
-- node_key is the exact model-facing identifier:
--   {app_name}-{node_name}-{node_version}
-- app_key remains provider-qualified internal identity and is denormalized onto nodes.

-- Free the display-name columns before assigning the machine-name columns their final names.
ALTER TABLE "apps" RENAME COLUMN "app_name" TO "app_display_name";
--> statement-breakpoint
ALTER TABLE "apps" RENAME COLUMN "app_slug" TO "app_name";
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "allowed_request_origins" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- Legacy MCP/server identifiers were not constrained to the new machine-name grammar. Drop the
-- old name indexes before normalization so two distinct legacy values can be collision-resolved in
-- one statement without a transient unique-index violation.
DROP INDEX IF EXISTS "idx_apps_global_slug_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_apps_workspace_slug_unique";
--> statement-breakpoint
WITH "app_name_candidates" AS (
  SELECT
    "app_id",
    "catalog_scope",
    "workspace_id",
    "app_name" AS "legacy_name",
    COALESCE(
      NULLIF(trim(BOTH '_' FROM regexp_replace(lower("app_name"), '[^a-z0-9_]+', '_', 'g')), ''),
      'app_' || left(md5("app_id"), 8)
    ) AS "normalized_name",
    COALESCE(
      "metadata"->'sourced_from'->>'provider_app_slug',
      "metadata"->>'provider_app_slug',
      "metadata"->'sourced_from'->>'provider_app_id',
      "metadata"->>'provider_app_id',
      NULLIF("app_key", ''),
      "app_id"
    ) AS "stable_identity"
  FROM "apps"
),
"ranked_app_names" AS (
  SELECT
    *,
    count(*) OVER (
      PARTITION BY "catalog_scope", "workspace_id", "normalized_name"
    ) AS "normalized_name_count"
  FROM "app_name_candidates"
),
"final_app_names" AS (
  SELECT
    "app_id",
    CASE
      WHEN "normalized_name" <> lower("legacy_name")
        OR length("normalized_name") > 49
        OR "normalized_name_count" > 1
      THEN left("normalized_name", 40) || '_' || left(md5("stable_identity"), 8)
      ELSE "normalized_name"
    END AS "app_name"
  FROM "ranked_app_names"
)
UPDATE "apps" AS "app"
SET "app_name" = "final_name"."app_name"
FROM "final_app_names" AS "final_name"
WHERE "app"."app_id" = "final_name"."app_id";
--> statement-breakpoint

-- Preserve already-qualified MCP/provider keys. Old native rows used a bare app slug.
UPDATE "apps"
SET "app_key" = CASE
  WHEN "app_key" LIKE '%:%' THEN "app_key"
  ELSE 'native:' || "app_name"
END;
--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "app_key" DROP DEFAULT;
--> statement-breakpoint

ALTER TABLE "nodes" RENAME COLUMN "node_name" TO "node_display_name";
--> statement-breakpoint
ALTER TABLE "nodes" RENAME COLUMN "node_slug" TO "node_name";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_nodes_app_slug_unique";
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "app_key" text NOT NULL DEFAULT '';
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "nodes" AS "node"
    LEFT JOIN "apps" AS "app" ON "app"."app_id" = "node"."app_id"
    WHERE "app"."app_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'nodes contain orphan app_id values';
  END IF;
END $$;
--> statement-breakpoint

UPDATE "nodes" AS "node"
SET "app_key" = "app"."app_key"
FROM "apps" AS "app"
WHERE "app"."app_id" = "node"."app_id";
--> statement-breakpoint
ALTER TABLE "nodes" ALTER COLUMN "app_key" DROP DEFAULT;
--> statement-breakpoint

CREATE TEMP TABLE "node_identity_mappings" (
  "node_id" text PRIMARY KEY,
  "catalog_scope" text NOT NULL,
  "workspace_id" text,
  "old_node_key" text NOT NULL,
  "old_tool_name" text,
  "new_node_key" text,
  "node_version" integer NOT NULL
);
--> statement-breakpoint
INSERT INTO "node_identity_mappings" (
  "node_id",
  "catalog_scope",
  "workspace_id",
  "old_node_key",
  "old_tool_name",
  "node_version"
)
SELECT
  "node_id",
  "catalog_scope",
  "workspace_id",
  "node_key",
  "metadata"->>'tool_id',
  "node_version"
FROM "nodes";
--> statement-breakpoint

-- Reserve three digits for future node versions while keeping every model-facing name <= 64.
-- Legacy MCP names were arbitrary, so lossy or colliding names receive a stable hash suffix.
WITH "node_name_candidates" AS (
  SELECT
    "node"."node_id",
    "node"."app_id",
    "app"."app_name",
    "node"."node_name" AS "legacy_name",
    COALESCE(
      NULLIF(trim(BOTH '_' FROM regexp_replace(lower("node"."node_name"), '[^a-z0-9_]+', '_', 'g')), ''),
      'node_' || left(md5("node"."node_id"), 8)
    ) AS "normalized_name",
    64 - length("app"."app_name") - 3 - 2 AS "maximum_name_length",
    COALESCE(
      "node"."provider_node_key",
      "node"."metadata"->>'provider_component_key',
      "node"."runtime_handler",
      "node"."node_id"
    ) AS "provider_component_id"
  FROM "nodes" AS "node"
  JOIN "apps" AS "app" ON "app"."app_id" = "node"."app_id"
),
"ranked_node_names" AS (
  SELECT
    *,
    count(*) OVER (
      PARTITION BY "app_id", "normalized_name"
    ) AS "normalized_name_count"
  FROM "node_name_candidates"
)
UPDATE "nodes" AS "node"
SET "node_name" = CASE
  WHEN "normalized"."normalized_name" = lower("normalized"."legacy_name")
    AND length("normalized"."normalized_name") <= "normalized"."maximum_name_length"
    AND "normalized"."normalized_name_count" = 1
  THEN "normalized"."normalized_name"
  ELSE left(
    "normalized"."normalized_name",
    GREATEST("normalized"."maximum_name_length" - 9, 1)
  ) || '_' || left(md5("normalized"."provider_component_id"), 8)
END
FROM "ranked_node_names" AS "normalized"
WHERE "node"."node_id" = "normalized"."node_id";
--> statement-breakpoint

-- Move provider_node_key and the old metadata fields into the single provenance object before
-- dropping them. Existing sourced_from fields are retained for keys the old source does not fill.
UPDATE "nodes" AS "node"
SET "node_config" = jsonb_set(
  COALESCE("node"."node_config", '{}'::jsonb),
  '{sourced_from}',
  COALESCE("node"."node_config"->'sourced_from', '{}'::jsonb) || jsonb_strip_nulls(
    jsonb_build_object(
      'provider', "node"."provider_key",
      'provider_app_id', COALESCE(
        "app"."metadata"->'sourced_from'->>'provider_app_id',
        "app"."metadata"->>'provider_app_id',
        "app"."app_key"
      ),
      'provider_component_id', COALESCE(
        "node"."provider_node_key",
        "node"."metadata"->>'provider_component_key',
        "node"."runtime_handler"
      ),
      'provider_component_version', "node"."metadata"->>'provider_version',
      'synced_from_catalog_time', "node"."last_updated_time"
    )
  ),
  true
)
FROM "apps" AS "app"
WHERE "app"."app_id" = "node"."app_id";
--> statement-breakpoint

UPDATE "nodes" AS "node"
SET "node_key" = "app"."app_name" || '-' || "node"."node_name" || '-' || "node"."node_version"::text
FROM "apps" AS "app"
WHERE "app"."app_id" = "node"."app_id";
--> statement-breakpoint
ALTER TABLE "nodes" ALTER COLUMN "node_key" DROP DEFAULT;
--> statement-breakpoint

UPDATE "node_identity_mappings" AS "mapping"
SET "new_node_key" = "node"."node_key"
FROM "nodes" AS "node"
WHERE "node"."node_id" = "mapping"."node_id";
--> statement-breakpoint

-- Every durable reference must move with the catalog identity. Workspace rows take precedence over
-- global rows when an old key happened to exist in both scopes.
UPDATE "nodes" AS "node"
SET "successor_node_key" = (
  SELECT "mapping"."new_node_key"
  FROM "node_identity_mappings" AS "mapping"
  WHERE "mapping"."old_node_key" = "node"."successor_node_key"
    AND (
      ("mapping"."catalog_scope" = 'workspace' AND "mapping"."workspace_id" = "node"."workspace_id")
      OR ("mapping"."catalog_scope" = 'global' AND "mapping"."workspace_id" IS NULL)
    )
  ORDER BY CASE WHEN "mapping"."workspace_id" = "node"."workspace_id" THEN 0 ELSE 1 END
  LIMIT 1
)
WHERE "node"."successor_node_key" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "node_identity_mappings" AS "mapping"
    WHERE "mapping"."old_node_key" = "node"."successor_node_key"
      AND (
        ("mapping"."catalog_scope" = 'workspace' AND "mapping"."workspace_id" = "node"."workspace_id")
        OR ("mapping"."catalog_scope" = 'global' AND "mapping"."workspace_id" IS NULL)
      )
  );
--> statement-breakpoint

UPDATE "agents" AS "agent"
SET
  "agent_config" = jsonb_set(
    "agent"."agent_config",
    '{enabled_nodes}',
    COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN "replacement"."new_node_key" IS NULL THEN "enabled"."value"
          ELSE jsonb_set(
            "enabled"."value" - 'capability_key' - 'tool_name',
            '{node_key}',
            to_jsonb("replacement"."new_node_key"),
            true
          )
        END
        ORDER BY "enabled"."position"
      )
      FROM jsonb_array_elements("agent"."agent_config"->'enabled_nodes')
        WITH ORDINALITY AS "enabled"("value", "position")
      LEFT JOIN LATERAL (
        SELECT "mapping"."new_node_key"
        FROM "node_identity_mappings" AS "mapping"
        WHERE "mapping"."old_node_key" = "enabled"."value"->>'node_key'
          AND (
            ("mapping"."catalog_scope" = 'workspace' AND "mapping"."workspace_id" = "agent"."workspace_id")
            OR ("mapping"."catalog_scope" = 'global' AND "mapping"."workspace_id" IS NULL)
          )
        ORDER BY CASE WHEN "mapping"."workspace_id" = "agent"."workspace_id" THEN 0 ELSE 1 END
        LIMIT 1
      ) AS "replacement" ON true
    ), '[]'::jsonb),
    true
  ),
  "last_updated_time" = now(),
  "last_updated_by" = 'system:node_identity_migration'
WHERE jsonb_typeof("agent"."agent_config"->'enabled_nodes') = 'array';
--> statement-breakpoint

ALTER TABLE "tool_calls" ADD COLUMN IF NOT EXISTS "node_version" integer;
--> statement-breakpoint
WITH "tool_call_identity_mappings" AS (
  SELECT
    "tool_call"."tool_call_id",
    "mapping"."node_id",
    "mapping"."new_node_key",
    "mapping"."node_version"
  FROM "tool_calls" AS "tool_call"
  JOIN LATERAL (
    SELECT "candidate".*
    FROM "node_identity_mappings" AS "candidate"
    WHERE (
        ("tool_call"."node_id" IS NOT NULL AND "candidate"."node_id" = "tool_call"."node_id")
        OR (
          "tool_call"."node_id" IS NULL
          AND (
            "candidate"."old_node_key" = "tool_call"."tool_name"
            OR "candidate"."old_tool_name" = "tool_call"."tool_name"
          )
        )
      )
      AND (
        ("candidate"."catalog_scope" = 'workspace' AND "candidate"."workspace_id" = "tool_call"."workspace_id")
        OR ("candidate"."catalog_scope" = 'global' AND "candidate"."workspace_id" IS NULL)
      )
    ORDER BY
      CASE WHEN "candidate"."node_id" = "tool_call"."node_id" THEN 0 ELSE 1 END,
      CASE WHEN "candidate"."workspace_id" = "tool_call"."workspace_id" THEN 0 ELSE 1 END
    LIMIT 1
  ) AS "mapping" ON true
)
UPDATE "tool_calls" AS "tool_call"
SET
  "node_id" = "identity"."node_id",
  "node_version" = "identity"."node_version",
  "tool_name" = "identity"."new_node_key",
  "tool_call_metadata" = "tool_call"."tool_call_metadata" || jsonb_build_object(
    'node_provenance', "node"."node_config"->'sourced_from'
  ),
  "last_updated_time" = now(),
  "last_updated_by" = 'system:node_identity_migration'
FROM "tool_call_identity_mappings" AS "identity"
JOIN "nodes" AS "node" ON "node"."node_id" = "identity"."node_id"
WHERE "tool_call"."tool_call_id" = "identity"."tool_call_id";
--> statement-breakpoint

-- Fail before destructive drops if any row cannot satisfy the new identity contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "apps"
    WHERE "app_name" !~ '^[a-z0-9_]+$'
      OR length("app_name") > 49
      OR "app_key" = ''
      OR "app_key" NOT LIKE '%:%'
  ) THEN
    RAISE EXCEPTION 'apps contain invalid app_name or provider-qualified app_key values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "apps"
    WHERE "catalog_scope" = 'global' AND "workspace_id" IS NULL
    GROUP BY "app_name"
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM "apps"
    WHERE "catalog_scope" = 'workspace'
    GROUP BY "workspace_id", "app_name"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'apps contain duplicate scoped app_name values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "nodes" AS "node"
    JOIN "apps" AS "app" ON "app"."app_id" = "node"."app_id"
    WHERE "node"."app_key" <> "app"."app_key"
      OR "node"."node_name" !~ '^[a-z0-9_]+$'
      OR "node"."node_version" NOT BETWEEN 1 AND 999
      OR length("node"."node_key") > 64
      OR "node"."node_key" <> "app"."app_name" || '-' || "node"."node_name" || '-' || "node"."node_version"::text
      OR COALESCE("node"."node_config"->'sourced_from'->>'provider_component_id', '') = ''
  ) THEN
    RAISE EXCEPTION 'nodes contain invalid identity or provenance values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "nodes"
    WHERE "catalog_scope" = 'global' AND "workspace_id" IS NULL
    GROUP BY "node_key"
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM "nodes"
    WHERE "catalog_scope" = 'workspace'
    GROUP BY "workspace_id", "node_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'nodes contain duplicate scoped node_key values';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "nodes" DROP COLUMN IF EXISTS "capability_key";
--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN IF EXISTS "node_family_key";
--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN IF EXISTS "provider_node_key";
--> statement-breakpoint
DROP TABLE "node_identity_mappings";

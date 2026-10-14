-- The original default was an implicit platform choice, not a user pin. Clearing it lets the
-- declarative agent-run policy choose a configured proxy instead of treating a bare GPT id as an
-- OpenAI-direct pin.
-- Nothing enforces that a NULL provider means "never pinned", so the values are kept under
-- model_pin_cleared_by_migration_0040 rather than destroyed. If the reading turns out to be wrong
-- for some workspace, its pin is recoverable from the row itself.
UPDATE "agents"
SET
  "default_model" = NULL,
  "default_model_provider" = NULL,
  "default_model_name" = NULL,
  "agent_config" = ("agent_config" - 'model_proxy') || jsonb_build_object(
    'model_pin_cleared_by_migration_0040',
    jsonb_build_object(
      'default_model', "default_model",
      'default_model_name', "default_model_name",
      'model_proxy', "agent_config" -> 'model_proxy'
    )
  ),
  "last_updated_time" = now(),
  "last_updated_by" = 'system'
WHERE
  "default_model_provider" IS NULL
  AND COALESCE("default_model_name", "default_model") = 'gpt-5.5';
--> statement-breakpoint

-- Persist the proxy separately for every existing user pin. Namespaced ids are Gateway routes;
-- bare ids use the direct proxy declared by their provider. Existing JSON metadata is preserved.
UPDATE "agents"
SET
  "default_model_provider" = CASE
    WHEN COALESCE("default_model_name", "default_model") LIKE '%/%'
      THEN lower(split_part(COALESCE("default_model_name", "default_model"), '/', 1))
    ELSE lower("default_model_provider")
  END,
  "agent_config" = "agent_config" || jsonb_build_object(
    'model_proxy',
    CASE
      WHEN COALESCE("default_model_name", "default_model") LIKE '%/%'
        THEN 'vercel_ai_gateway'
      WHEN lower("default_model_provider") = 'anthropic'
        THEN 'anthropic_direct'
      WHEN lower("default_model_provider") = 'openai'
        THEN 'openai_direct'
    END
  ),
  "last_updated_time" = now(),
  "last_updated_by" = 'system'
WHERE
  COALESCE("default_model_name", "default_model") IS NOT NULL
  AND NOT ("agent_config" ? 'model_proxy')
  AND (
    COALESCE("default_model_name", "default_model") LIKE '%/%'
    OR lower("default_model_provider") IN ('anthropic', 'openai')
  );
--> statement-breakpoint

-- A gateway provider on a bare model id contradicts itself: gateway routes are always namespaced.
-- The statement above skips these rows, which leaves the API reporting no saved route while the
-- runtime still resolves the id through whichever proxy claims it. Clearing the stale provider
-- makes both sides read the row the same way.
UPDATE "agents"
SET
  "default_model_provider" = NULL,
  "last_updated_time" = now(),
  "last_updated_by" = 'system'
WHERE
  lower("default_model_provider") IN ('ai_gateway', 'vercel_ai_gateway')
  AND COALESCE("default_model_name", "default_model") IS NOT NULL
  AND COALESCE("default_model_name", "default_model") NOT LIKE '%/%';
--> statement-breakpoint

-- Recover the actual provider from historical namespaced model ids and retain the route identity
-- in metadata.
UPDATE "runs"
SET
  "model_provider" = lower(split_part("model_name", '/', 1)),
  "provider_name" = lower(split_part("model_name", '/', 1)),
  "run_metadata" = "run_metadata" || '{"model_proxy":"vercel_ai_gateway"}'::jsonb,
  "last_updated_time" = now(),
  "last_updated_by" = 'system'
WHERE
  lower(COALESCE("model_provider", "provider_name", '')) IN ('ai_gateway', 'vercel_ai_gateway')
  AND "model_name" LIKE '%/%';
--> statement-breakpoint

-- Usage summaries group by the model provider. Join through the run to keep historical Gateway
-- usage in the same provider bucket as new writes while preserving the proxy in metadata.
UPDATE "usage_records" AS usage
SET
  "provider" = run."model_provider",
  "provider_name" = run."model_provider",
  "usage_metadata" = usage."usage_metadata" || '{"model_proxy":"vercel_ai_gateway"}'::jsonb,
  "last_updated_time" = now(),
  "last_updated_by" = 'system'
FROM "runs" AS run
WHERE
  usage."run_id" = run."run_id"
  AND lower(COALESCE(usage."provider", usage."provider_name", ''))
    IN ('ai_gateway', 'vercel_ai_gateway')
  AND run."run_metadata"->>'model_proxy' = 'vercel_ai_gateway';

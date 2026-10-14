ALTER TABLE "triggers" ADD COLUMN "trigger_source" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "trigger_target" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "triggers"
SET
  "trigger_source" = jsonb_build_object(
    'kind',
    CASE
      WHEN "trigger_type" = 'slack_event' THEN 'app_event'
      WHEN "trigger_type" = 'slack_mention' THEN 'app_event'
      WHEN "trigger_type" = 'slack_channel' THEN 'app_event'
      WHEN "trigger_type" = 'api_event' THEN 'webhook'
      ELSE "trigger_type"
    END,
    'legacy_trigger_type',
    "trigger_type",
    'legacy_config',
    "trigger_config"
  ),
  "trigger_target" = CASE
    WHEN "node_id" IS NOT NULL THEN jsonb_build_object('kind', 'node_run', 'node_id', "node_id")
    ELSE jsonb_build_object('kind', 'agent_run', 'agent_id', "agent_id")
  END
WHERE "trigger_source" = '{}'::jsonb;--> statement-breakpoint
UPDATE "triggers"
SET "trigger_type" = CASE
  WHEN "trigger_type" = 'slack_event' THEN 'app_event'
  WHEN "trigger_type" = 'slack_mention' THEN 'app_event'
  WHEN "trigger_type" = 'slack_channel' THEN 'app_event'
  WHEN "trigger_type" = 'api_event' THEN 'webhook'
  ELSE "trigger_type"
END;--> statement-breakpoint

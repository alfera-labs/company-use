-- Give every workspace its own minute for the two system schedules.
--
-- Both were provisioned from a constant: `1 8,11,14,17 * * 1-5` for "Agent heartbeat" and
-- `0 9 * * 1` for "Workspace discovery". Byte-identical across every workspace, so four times a
-- weekday the entire fleet fired in the same second — a stampede that took the API down for
-- twenty minutes. New rows are spread at creation time by `add_schedule_jitter` in
-- packages/core/src/services/schedule_jitter.ts; this moves the rows that already exist.
--
-- The minute is a pure function of the workspace id, and the expression below is the SQL twin of
-- that TypeScript function: the first three bytes of md5(workspace_id), big-endian, modulo 60.
-- The pairing is pinned by a test that runs both over the same ids
-- (packages/core/src/db/__tests__/schedule_jitter_migration.test.ts). Because the new minute
-- depends only on the id and never on the current minute, re-running this changes nothing.
--
-- Only these two system schedules are touched. A minute that is not a bare number (`*/4`, `0,30`)
-- is left alone, and user-created tasks are left alone entirely — nobody's `0 */4 * * *` gets
-- rewritten here.
--
-- The cloud scheduler still holds the old cron after this runs. The boot sweep in
-- apps/api/src/services/provisioning/workspace_trigger_reconcile.ts re-asserts each row's
-- schedule_expression on the next deploy, which is what carries the new minute to the provider.
UPDATE "triggers"
SET "schedule_expression" = regexp_replace(
      "schedule_expression",
      '^\d{1,2}',
      ((('x' || substr(md5("workspace_id"), 1, 6))::bit(24)::int) % 60)::text
    ),
    "last_updated_time" = now(),
    "last_updated_by" = 'system:schedule_jitter_backfill'
WHERE "trigger_type" = 'schedule'
  AND "schedule_expression" ~ '^\d{1,2}\s'
  AND (
    ("trigger_name" = 'Agent heartbeat'
      AND "trigger_config" ->> 'starts_job_handler' = 'run_agent_heartbeat')
    OR ("trigger_name" = 'Workspace discovery'
      AND "trigger_config" ->> 'starts_job_handler' = 'run_workspace_discovery')
  )
  -- Already on its own minute: skip, so a second run touches no rows at all.
  AND substring("schedule_expression" from '^\d{1,2}')::int
      IS DISTINCT FROM ((('x' || substr(md5("workspace_id"), 1, 6))::bit(24)::int) % 60);

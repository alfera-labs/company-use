-- One Alfera workspace per exclusive channel account. Native Slack routes inbound
-- events solely by the Slack team_id (external_account_id), so a team may belong to
-- at most one workspace at a time; a second workspace connecting the same team is a
-- conflict, not a silent takeover. This partial unique index is the backstop that
-- makes the invariant race-proof: a second finalize-to-active for an already-claimed
-- team fails at the database.
--
-- Scoped to native Slack on purpose. Providers routed per-connection (their
-- external_account_id is NOT globally unique — two workspaces can legitimately
-- hold the same account id) must stay out of this predicate. Keep this list in sync
-- with exclusive_external_account_provider_configs in
-- packages/runtime-platform/src/channels/exclusive_external_account_claims.ts.
--
-- Before enforcing the invariant, collapse any pre-existing duplicate active claims the old
-- "newest install wins" behavior could have created (otherwise the unique index cannot be
-- built). First claim wins: keep the earliest-connected active native-Slack connection per team
-- and revoke the rest. Idempotent: once no team has two active claims, the EXISTS is never true.
UPDATE "connections" AS c
SET "connection_status" = 'revoked',
    "health_status" = 'unhealthy',
    "revoked_time" = now(),
    "last_updated_time" = now()
WHERE c."provider_key" = 'native'
  AND c."provider_config_key" = 'native:slack'
  AND c."connection_status" = 'active'
  AND c."external_account_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "connections" AS keep
    WHERE keep."provider_key" = 'native'
      AND keep."provider_config_key" = 'native:slack'
      AND keep."connection_status" = 'active'
      AND keep."external_account_id" = c."external_account_id"
      AND keep."connection_id" <> c."connection_id"
      AND (
        coalesce(keep."connected_time", keep."created_time")
          < coalesce(c."connected_time", c."created_time")
        OR (
          coalesce(keep."connected_time", keep."created_time")
            = coalesce(c."connected_time", c."created_time")
          AND keep."connection_id" < c."connection_id"
        )
      )
  );--> statement-breakpoint
-- Idempotent: IF NOT EXISTS makes a re-run a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_connections_exclusive_account_active"
ON "connections" USING btree ("provider_key", "provider_config_key", "external_account_id")
WHERE "connection_status" = 'active'
  AND "provider_key" = 'native'
  AND "provider_config_key" = 'native:slack'
  AND "external_account_id" IS NOT NULL;

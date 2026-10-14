import { create_workspace_scout_trigger } from '@api/services/scout/scout_provisioning';
import { create_workspace_system_automation_triggers } from '@api/services/triggers/system_automation_schedules';
import { connections, type Database } from '@coworker/core';
import { list_automation_workspace_ids } from '@coworker/core/db/queries/automation_reads';
import {
  claim_workspace_trigger_reconcile,
  release_workspace_trigger_reconcile,
} from '@coworker/core/db/queries/trigger_scheduling';
import { create_logger, format_error_message } from '@coworker/shared';
import { native_slack_provider_config_key } from '@runtime-platform/tools/slack/app_profile';
import { and, eq } from 'drizzle-orm';

const log = create_logger('trigger_reconcile');
const reconcile_actor = 'system:trigger_reconcile';
const trigger_reconcile_version = 'attention-tick-v1';

export async function provision_missing_workspace_triggers(db: Database) {
  const slack_workspace_ids = await list_slack_connected_workspace_ids(db);
  const automation_workspace_ids = await list_automation_workspace_ids(db);
  const workspace_ids = [...new Set([...slack_workspace_ids, ...automation_workspace_ids])];
  const slack_workspaces = new Set(slack_workspace_ids);
  const today = new Date().toISOString().slice(0, 10);
  const reconcile_key = `${today}:${trigger_reconcile_version}`;
  let reconciled = 0;

  for (const workspace_id of workspace_ids) {
    const claimed = await claim_workspace_trigger_reconcile(db, {
      workspace_id,
      reconcile_date: today,
      reconcile_key,
      actor_id: reconcile_actor,
    });
    if (!claimed) continue;

    try {
      if (slack_workspaces.has(workspace_id)) {
        await create_workspace_scout_trigger(db, { workspace_id, actor_id: reconcile_actor });
      }
      await create_workspace_system_automation_triggers(db, {
        workspace_id,
        actor_id: reconcile_actor,
      });
      reconciled += 1;
    } catch (error) {
      log.error('workspace provisioning failed', {
        workspace_id,
        error: format_error_message(error),
      });
      await release_workspace_trigger_reconcile(db, {
        workspace_id,
        reconcile_key,
        actor_id: reconcile_actor,
      }).catch((error: unknown) => log.warn('Claim release failed', { workspace_id, error }));
    }
  }

  return { workspaces_checked: workspace_ids.length, workspaces_reconciled: reconciled };
}

async function list_slack_connected_workspace_ids(db: Database) {
  const rows = await db
    .selectDistinct({ workspace_id: connections.workspace_id })
    .from(connections)
    .where(
      and(
        eq(connections.provider_config_key, native_slack_provider_config_key),
        eq(connections.connection_status, 'active'),
      ),
    );
  return rows.map((row) => row.workspace_id);
}

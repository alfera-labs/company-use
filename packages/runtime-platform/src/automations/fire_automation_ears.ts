import type { Database } from '@coworker/core';
import { list_triggers } from '@coworker/core/db/queries/trigger_reads';
import { create_logger, format_error_message } from '@coworker/shared';
import { fire_trigger } from '@runtime-platform/events/fire_trigger';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { apply_trigger_rules } from '@runtime-platform/triggers/trigger_rules';

const log = create_logger('automation_ears');

export type FiredEar = { trigger_id: string; automation_id: string; event_id: string };
export type SilentEar = { trigger_id: string; reason: string };

export async function fire_automation_ears(
  db: Database,
  input: {
    workspace_id: string;
    node_key: string;
    occurrence_key: string;
    data: Record<string, unknown>;
    received_time?: Date;
    skip_automation_id?: string | null;
    matches_setup?: (subscription_config: Record<string, unknown>) => boolean;
  },
): Promise<{ fired: FiredEar[]; silent: SilentEar[] }> {
  const ears = await list_workspace_ears(db, input.workspace_id, input.node_key);
  const fired: FiredEar[] = [];
  const silent: SilentEar[] = [];

  for (const ear of ears) {
    const automation_id = ear.automation_id ?? '';
    if (input.skip_automation_id && automation_id === input.skip_automation_id) {
      silent.push({
        trigger_id: ear.trigger_id,
        reason: 'this automation is what wrote the event',
      });
      continue;
    }
    const setup = ear.trigger_config.event_source?.subscription_config ?? {};
    if (input.matches_setup && !input.matches_setup(setup)) {
      silent.push({ trigger_id: ear.trigger_id, reason: 'this ear is set up for somewhere else' });
      continue;
    }
    const rules = apply_trigger_rules(ear.trigger_config.rules ?? [], input.data);
    if (!rules.passed) {
      silent.push({ trigger_id: ear.trigger_id, reason: rules.reason });
      continue;
    }
    try {
      const result = await fire_trigger(db, ear, {
        occurrence_key: input.occurrence_key,
        delivery: {
          provider: 'native',
          trigger_slug: input.node_key,
          received_time: (input.received_time ?? new Date()).toISOString(),
          data: input.data,
        },
      });
      if (result)
        fired.push({ trigger_id: ear.trigger_id, automation_id, event_id: result.event_id });
    } catch (error) {
      log.error('an automation ear could not be fired', {
        workspace_id: input.workspace_id,
        trigger_id: ear.trigger_id,
        node_key: input.node_key,
        error: format_error_message(error),
      });
    }
  }

  return { fired, silent };
}

// The workspace's triggers, filtered in memory. A workspace holds tens of them, and the
// node key lives in jsonb. Upgrade path when that stops being true: an index on
// (workspace_id, trigger_config->'event_source'->>'node_key').
async function list_workspace_ears(db: Database, workspace_id: string, node_key: string) {
  const triggers = await list_triggers(db, workspace_id);
  return triggers.filter(
    (trigger: TriggerRow) =>
      Boolean(trigger.automation_id) &&
      trigger.trigger_status === 'enabled' &&
      trigger.trigger_config.event_source?.node_key === node_key,
  );
}

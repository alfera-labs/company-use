import { is_open_provider_trigger } from '@api/services/automations/app_trigger_limit';
import type { AutomationTriggerInput } from '@api/services/automations/automation_input';
import {
  delete_automation_trigger,
  provision_automation_trigger,
} from '@api/services/automations/automation_trigger_wiring';
import {
  type AutomationTriggerOwner,
  plan_automation_triggers,
} from '@api/services/automations/automation_triggers';
import type { Database } from '@coworker/core';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { create_logger, format_error_message } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import type { TriggerRowWithNewSecret } from '@runtime-platform/triggers/trigger_webhook_secret';

const log = create_logger('automation_trigger_replacement');

export async function replace_automation_triggers(
  db: Database,
  owner: AutomationTriggerOwner,
  wanted: AutomationTriggerInput[],
): Promise<TriggerRowWithNewSecret[]> {
  const current = await list_automation_triggers(db, owner);
  const kept = current.filter((trigger) => wanted.some((input) => is_same_ear(input, trigger)));
  const leaving = current.filter((trigger) => !kept.includes(trigger));
  const additions = wanted.filter((input) => !kept.some((trigger) => is_same_ear(input, trigger)));
  const written = await write_new_ears(db, owner, additions, leaving);

  // An ear the provider will not take down stays open, so the count can overshoot by it.
  const survivors: TriggerRow[] = [];
  for (const trigger of leaving) {
    if (!(await remove_one_ear(db, trigger))) survivors.push(trigger);
  }

  const created = await Promise.all(
    written.map(async (ear) => ({
      ...(await provision_automation_trigger(db, ear.trigger, ear.connected_account_id)),
      new_webhook_secret: ear.new_webhook_secret,
    })),
  );
  return [...kept, ...survivors, ...created].sort(
    (a, b) => a.created_time.getTime() - b.created_time.getTime(),
  );
}

async function write_new_ears(
  db: Database,
  owner: AutomationTriggerOwner,
  additions: AutomationTriggerInput[],
  leaving: TriggerRow[],
) {
  return db.transaction(async (transaction) => {
    const planned = await plan_automation_triggers(
      transaction,
      owner,
      additions,
      leaving.filter(is_open_provider_trigger).length,
    );
    return Promise.all(
      planned.map(async (plan) => ({
        trigger: await create_trigger(transaction, plan.row),
        connected_account_id: plan.connected_account_id,
        new_webhook_secret: plan.new_webhook_secret,
      })),
    );
  });
}

async function remove_one_ear(db: Database, trigger: TriggerRow): Promise<boolean> {
  try {
    await delete_automation_trigger(db, {
      workspace_id: trigger.workspace_id,
      trigger_id: trigger.trigger_id,
    });
    return true;
  } catch (error) {
    const reason = format_error_message(error);
    log.error('an ear survived its edit', { trigger_id: trigger.trigger_id, reason });
    return false;
  }
}

function is_same_ear(input: AutomationTriggerInput, trigger: TriggerRow): boolean {
  const row_key = trigger_row_key(trigger);
  if (input.kind !== 'app_event' || input.connection_id !== undefined) {
    return trigger_input_key(input) === row_key;
  }
  return row_key.startsWith(trigger_input_key(input));
}

function trigger_input_key(input: AutomationTriggerInput): string {
  if (input.kind === 'schedule') return `schedule|${input.cron}|${input.timezone ?? ''}`;
  if (input.kind === 'manual') return 'manual';
  if (input.kind === 'webhook') return 'webhook';
  return `app_event|${input.node_key}|${stable(input.subscription_config)}|${stable(input.conditions)}|${input.connection_id ?? ''}`;
}

function trigger_row_key(trigger: TriggerRow): string {
  const config = trigger.trigger_config;
  if (trigger.trigger_type === 'schedule') {
    return `schedule|${trigger.schedule_expression ?? ''}|${config.timezone ?? ''}`;
  }
  if (trigger.trigger_type === 'manual') return 'manual';
  if (trigger.trigger_type === 'webhook') return 'webhook';
  const source = config.event_source;
  return `app_event|${source?.node_key ?? ''}|${stable(source?.subscription_config ?? {})}|${stable(config.rules ?? [])}|${source?.connection_id ?? ''}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

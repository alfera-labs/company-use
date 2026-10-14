import type { Database } from '@coworker/core';
import { triggers as triggers_table } from '@coworker/core/db/schema';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  dead,
  healthy,
  missing_connection_detail,
  read_connected_accounts,
  read_own_wire_health,
  type TriggerWireHealth,
  type WiredTrigger,
} from '@runtime-platform/automations/trigger_wire_accounts';
import { list_composio_trigger_instances } from '@runtime-platform/composio/composio_triggers';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { plain_provider_error } from '@runtime-platform/triggers/provider_error_words';
import { eq, sql } from 'drizzle-orm';

const log = create_logger('trigger_wire_health');
const watchdog_actor = 'system:automation_watchdog';

export type WatchdogWireReader = typeof list_composio_trigger_instances;

export type { TriggerWireHealth };

export async function read_trigger_wire_health(
  db: Database,
  workspace_id: string,
  triggers: TriggerRow[],
  read_instances: WatchdogWireReader = list_composio_trigger_instances,
  now: Date = new Date(),
): Promise<Map<string, TriggerWireHealth>> {
  const { health, composio_wires, own_wires } = sort_wires_by_owner(triggers, now);
  const verdicts = [
    ...(await read_own_wire_health(db, workspace_id, own_wires)),
    ...(await read_composio_wire_health(db, workspace_id, composio_wires, read_instances)),
  ];
  for (const [trigger_id, verdict] of verdicts) health.set(trigger_id, verdict);
  return health;
}

function sort_wires_by_owner(triggers: TriggerRow[], now: Date) {
  const health = new Map<string, TriggerWireHealth>();
  const composio_wires: WiredTrigger[] = [];
  const own_wires: WiredTrigger[] = [];
  for (const trigger of triggers) {
    const { provisioned_by, provisioning_key, event_source } = trigger.trigger_config;
    const connection_id = event_source?.connection_id;
    if (!provisioned_by || !provisioning_key || !connection_id) {
      health.set(trigger.trigger_id, read_unwired_health(trigger, now));
      continue;
    }
    const wired = { trigger, provisioning_key, connection_id };
    (provisioned_by === 'composio' ? composio_wires : own_wires).push(wired);
  }
  return { health, composio_wires, own_wires };
}

const wiring_grace_minutes = 10;

function read_unwired_health(trigger: TriggerRow, now: Date): TriggerWireHealth {
  const config = trigger.trigger_config;
  const waiting_for_its_wire =
    trigger.trigger_type === 'app_event' &&
    trigger.trigger_status === 'enabled' &&
    Boolean(config.provisioned_by) &&
    !config.provisioning_key;
  const grace_ends = trigger.last_updated_time.getTime() + wiring_grace_minutes * 60_000;
  if (!waiting_for_its_wire || now.getTime() < grace_ends) return healthy;
  return dead('The subscription was never set up at the provider.');
}

async function read_composio_wire_health(
  db: Database,
  workspace_id: string,
  wired: WiredTrigger[],
  read_instances: WatchdogWireReader,
): Promise<[string, TriggerWireHealth][]> {
  if (wired.length === 0) return [];
  const verdicts: [string, TriggerWireHealth][] = [];
  const accounts = await read_connected_accounts(db, workspace_id, wired);
  const by_account = new Map<string, WiredTrigger[]>();
  for (const item of wired) {
    const account = accounts.get(item.connection_id);
    if (typeof account === 'string') {
      by_account.set(account, [...(by_account.get(account) ?? []), item]);
    } else {
      verdicts.push([item.trigger.trigger_id, dead(account?.detail ?? missing_connection_detail)]);
    }
  }
  for (const [connected_account_id, group] of by_account) {
    const instances = await read_missing_provider_as_null(() =>
      read_instances({ connected_account_id }),
    );
    for (const item of group) {
      const verdict = instances ? read_instance_health(instances, item.provisioning_key) : healthy;
      verdicts.push([item.trigger.trigger_id, verdict]);
    }
  }
  return verdicts;
}

type ProviderInstance = Awaited<ReturnType<WatchdogWireReader>>[number];

function read_instance_health(
  instances: ProviderInstance[],
  provisioning_key: string,
): TriggerWireHealth {
  const instance = instances.find((candidate) => candidate.id === provisioning_key);
  if (!instance) return dead('The subscription no longer exists at the provider.');
  if (instance.disabled_at) {
    return dead(`The subscription was disabled at the provider on ${instance.disabled_at}.`);
  }
  return healthy;
}

export async function confirm_wire_health(
  db: Database,
  trigger: TriggerRow,
  verdict: TriggerWireHealth,
  now: Date,
): Promise<TriggerWireHealth> {
  const missing_since = trigger.trigger_config.wire_missing_since;
  if (verdict.is_dead && missing_since) return verdict;
  if (!verdict.is_dead && !missing_since) return verdict;
  const config_change = verdict.is_dead
    ? sql`${triggers_table.trigger_config} || ${JSON.stringify({ wire_missing_since: now.toISOString() })}::jsonb`
    : sql`${triggers_table.trigger_config} - 'wire_missing_since'`;
  await db
    .update(triggers_table)
    .set({
      trigger_config: config_change,
      last_updated_time: triggers_table.last_updated_time,
      last_updated_by: watchdog_actor,
    })
    .where(eq(triggers_table.trigger_id, trigger.trigger_id));
  return healthy;
}

export async function record_dead_wire(db: Database, trigger: TriggerRow, detail: string) {
  await db
    .update(triggers_table)
    .set({
      trigger_status: 'error',
      trigger_config: {
        ...trigger.trigger_config,
        provisioning_error: plain_provider_error(detail),
      },
      last_updated_time: new Date(),
      last_updated_by: watchdog_actor,
    })
    .where(eq(triggers_table.trigger_id, trigger.trigger_id));

  log.warn('a trigger wire is dead at the provider', {
    workspace_id: trigger.workspace_id,
    trigger_id: trigger.trigger_id,
    detail,
  });
}

async function read_missing_provider_as_null<T>(read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    log.warn('the provider could not say whether a wire is alive', {
      error: format_error_message(error),
    });
    return null;
  }
}

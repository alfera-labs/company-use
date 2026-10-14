import type { Database, events } from '@coworker/core';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { scout_config_key } from '@coworker/shared';
import { skipped_result } from '@runtime-platform/scout/scout_job_results';

type EventRecord = typeof events.$inferSelect;

export type ScoutConfig = {
  version: 1;
  mode?: 'autonomous_agent';
  max_output_tokens: number;
  recent_message_limit: number;
  max_actions: number;
  instruction?: string;
};
type StoredScoutConfig = Partial<ScoutConfig>;
type ScoutTriggerConfig = { [scout_config_key]?: StoredScoutConfig };
type TriggerFireBody = { trigger_id: string };

const default_scout_config: ScoutConfig = {
  version: 1,
  max_output_tokens: 1600,
  recent_message_limit: 30,
  max_actions: 3,
};

export async function read_scout_trigger(db: Database, records: EventRecord[]) {
  const fire = read_latest_trigger_fire(records);
  if (!fire) {
    return { ok: false as const, result: skipped_result('No trigger.fired event was available.') };
  }

  const trigger = await get_trigger_by_id(db, fire.trigger_id);
  if (trigger) return { ok: true as const, trigger };
  return {
    ok: false as const,
    result: skipped_result(`Trigger ${fire.trigger_id} no longer exists.`, 'no_trigger'),
  };
}

function read_latest_trigger_fire(records: EventRecord[]) {
  const latest = records
    .filter((record) => record.source === 'trigger')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())
    .at(-1);
  if (!latest) return null;

  return latest.event_body as TriggerFireBody;
}

export function read_scout_config(
  value: unknown,
): { ok: true; config: ScoutConfig } | { ok: false; message: string } {
  const stored = (value as ScoutTriggerConfig | null)?.[scout_config_key];
  if (stored) return { ok: true, config: { ...default_scout_config, ...stored } };
  return {
    ok: false,
    message: 'Scout configuration is missing.',
  };
}

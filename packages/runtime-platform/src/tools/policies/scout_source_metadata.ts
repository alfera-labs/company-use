import type { TriggerSourceData } from '@coworker/core/db/schema/json_column_types';
import { agent_heartbeat_config_key } from '@coworker/shared';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';

export type ScoutSourceMetadata = {
  [agent_heartbeat_config_key]: {
    source_event_id?: string;
    observed_event_ids: string[];
  };
};

export function get_scout_source_metadata(
  value: RuntimeToolSourceMetadata | TriggerSourceData | undefined,
): ScoutSourceMetadata | null {
  const scout = value?.[agent_heartbeat_config_key];
  if (!scout || scout.observed_event_ids.length === 0) return null;
  return {
    [agent_heartbeat_config_key]: {
      ...(scout.source_event_id ? { source_event_id: scout.source_event_id } : {}),
      observed_event_ids: scout.observed_event_ids,
    },
  };
}

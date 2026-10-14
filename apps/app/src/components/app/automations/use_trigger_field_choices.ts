// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { useQuery } from '@tanstack/react-query';
import { list_trigger_field_choices } from '@/components/app/automations/trigger_field_choices_api';
import { query_keys } from '@/lib/api/query_keys';

const choices_stale_time_ms = 5 * 60 * 1000;

export function use_trigger_field_choices(
  node_key: string,
  field_name: string,
  connection_id: string | undefined,
) {
  return useQuery({
    queryKey: query_keys.trigger_field_choices(node_key, field_name, connection_id),
    queryFn: () => list_trigger_field_choices(node_key, field_name, connection_id ?? ''),
    enabled: connection_id !== undefined,
    staleTime: choices_stale_time_ms,
  });
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  access_level_label,
  access_levels,
  type ConnectionAccessLevel,
  custom_access_label,
  read_connection_access_level,
} from '@/components/connections/connection_access_level';
import { get_preset_policy_change } from '@/components/connections/connection_tool_policy_state';
import { change_tool_policies, list_tool_policies } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function ConnectionAccessSelect({
  connection_id,
  label,
}: {
  connection_id: string;
  label: string;
}) {
  const query_client = useQueryClient();
  const query_key = query_keys.tool_policies('connection', connection_id);
  const policies_query = useQuery({
    queryKey: query_key,
    queryFn: () =>
      list_tool_policies({ scope_type: 'connection', scope_id: connection_id, limit: 500 }),
  });
  const save = useMutation({
    mutationFn: (level: ConnectionAccessLevel) =>
      change_tool_policies({
        scope_type: 'connection',
        scope_id: connection_id,
        ...get_preset_policy_change(policies_query.data ?? [], level),
      }),
    onSuccess: () => query_client.invalidateQueries({ queryKey: query_key }),
    onError: (error: Error) => toast.error(error.message),
  });

  if (policies_query.isPending) return <Skeleton className="h-7 w-44" />;

  const level = read_connection_access_level(policies_query.data ?? []);
  return (
    <Select
      // `items` is what turns the stored value into its label, so the closed control and the open
      // list say the same words.
      items={{
        ...(level === null ? { custom: custom_access_label } : {}),
        ...Object.fromEntries(access_levels.map((one) => [one.value, one.label])),
      }}
      value={level ?? 'custom'}
      disabled={save.isPending}
      onValueChange={(value) => save.mutate(value as ConnectionAccessLevel)}
    >
      <SelectTrigger aria-label={`Access level for ${label}`} className="w-44" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {level === null ? (
          <SelectItem disabled value="custom">
            {access_level_label(null)}
          </SelectItem>
        ) : null}
        {access_levels.map((one) => (
          <SelectItem key={one.value} value={one.value}>
            {one.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

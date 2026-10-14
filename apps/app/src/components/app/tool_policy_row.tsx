// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { delete_tool_policy, set_tool_policy } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { ToolPolicy, ToolPolicyMode, ToolPolicyScopeType } from '@/lib/api/types';

const mode_options = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask first' },
  { value: 'never', label: 'Never' },
] as const;

type ToolPolicyRowProps = {
  label: string;
  detail: string;
  unset_label: string;
  policy?: ToolPolicy;
  resource_id: string;
  scope_id: string;
  scope_type: ToolPolicyScopeType;
  read_only: boolean;
};

export function ToolPolicyRow(props: ToolPolicyRowProps) {
  const save = use_policy_save(props);
  return (
    <div className="flex items-center justify-between gap-4 bg-background px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium text-sm">{props.label}</div>
        <div className="text-muted-foreground text-xs">{props.detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {save.isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        {/* `items` is what turns the stored value into its label. Without it Base UI renders the
            raw value, so the closed control said "inherit" while the open menu said "Follow
            workspace rule" — the same control speaking two languages. */}
        <Select
          items={{
            inherit: props.unset_label,
            ...Object.fromEntries(mode_options.map((option) => [option.value, option.label])),
          }}
          value={(props.policy?.policy_mode as ToolPolicyMode | undefined) ?? 'inherit'}
          disabled={props.read_only || save.isPending}
          onValueChange={(value) => save.mutate(value as 'inherit' | ToolPolicyMode)}
        >
          <SelectTrigger className="w-52" aria-label={`${props.label} permission`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="inherit">{props.unset_label}</SelectItem>
            {mode_options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function use_policy_save(props: ToolPolicyRowProps) {
  const query_client = useQueryClient();
  function save_mode(value: 'inherit' | ToolPolicyMode) {
    if (value === 'inherit') {
      return props.policy ? delete_tool_policy(props.policy.policy_id) : Promise.resolve(null);
    }
    return set_tool_policy({
      resource_type: 'node_label',
      resource_id: props.resource_id,
      scope_type: props.scope_type,
      scope_id: props.scope_id,
      policy_mode: value,
    });
  }
  return useMutation({
    mutationFn: save_mode,
    onSuccess: () =>
      query_client.invalidateQueries({
        queryKey: query_keys.tool_policies(props.scope_type, props.scope_id),
      }),
    onError: (error: Error) => toast.error(error.message),
  });
}

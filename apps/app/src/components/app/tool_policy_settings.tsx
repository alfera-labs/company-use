import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ToolPolicyRow } from '@/components/app/tool_policy_row';
import { list_tool_policies } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { ToolPolicy, ToolPolicyScopeType } from '@/lib/api/types';
import { settings_section_path } from '@/lib/settings_navigation';

const policy_targets = [
  { resource_id: 'every_tool', label: 'All tools', detail: 'The default for every tool.' },
  { resource_id: 'only_reads', label: 'Read-only tools', detail: 'Tools that only read data.' },
  {
    resource_id: 'changes_things',
    label: 'Tools that change data',
    detail: 'Tools that create, update, or delete data.',
  },
  {
    resource_id: 'emails_outsiders',
    label: 'External email',
    detail: 'Tools that can email people outside the workspace.',
    asks_by_default: true,
  },
] as const;

function unset_mode_label(scope_type: ToolPolicyScopeType, asks_by_default: boolean) {
  if (scope_type !== 'workspace') return 'Follow workspace rules';
  return asks_by_default ? 'Asks first by default' : 'Runs by default';
}

type ToolPolicySettingsProps = {
  scope_type: ToolPolicyScopeType;
  scope_id: string;
  title?: string;
  description?: string;
  read_only?: boolean;
};

export function ToolPolicySettings({
  scope_type,
  scope_id,
  title = 'Tool permissions',
  description = 'Choose what Alfera can do in this scope.',
  read_only = false,
}: ToolPolicySettingsProps) {
  const query = useQuery({
    queryKey: query_keys.tool_policies(scope_type, scope_id),
    queryFn: () => list_tool_policies({ scope_type, scope_id, resource_type: 'node_label' }),
  });
  const policies = new Map(query.data?.map((policy) => [policy.resource_id, policy]));

  return (
    <section className="grid gap-3">
      <header className="grid gap-0.5">
        <h2 className="font-medium text-sm">{title}</h2>
        <p className="text-muted-foreground text-xs">{description}</p>
        <p className="text-muted-foreground text-xs">The strictest rule wins.</p>
        {scope_type !== 'workspace' ? (
          <p className="text-muted-foreground text-xs">
            Workspace rules:{' '}
            <Link
              className="underline hover:text-foreground"
              to={settings_section_path('policies')}
            >
              Settings
            </Link>
          </p>
        ) : null}
      </header>
      {query.isPending ? (
        <PolicySkeleton />
      ) : query.isError ? (
        <button
          type="button"
          className="rounded-2xl border p-4 text-left text-destructive text-sm"
          onClick={() => void query.refetch()}
        >
          The tool permissions could not load. Select this message to retry.
        </button>
      ) : (
        <ToolPolicyRows
          policies={policies}
          scope_id={scope_id}
          scope_type={scope_type}
          read_only={read_only}
        />
      )}
    </section>
  );
}

function ToolPolicyRows({
  policies,
  scope_id,
  scope_type,
  read_only,
}: {
  policies: Map<string, ToolPolicy>;
  scope_id: string;
  scope_type: ToolPolicyScopeType;
  read_only: boolean;
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border">
      {policy_targets.map((target) => {
        const policy = policies.get(target.resource_id);
        return (
          <ToolPolicyRow
            key={target.resource_id}
            label={target.label}
            detail={target.detail}
            unset_label={unset_mode_label(scope_type, 'asks_by_default' in target)}
            {...(policy ? { policy } : {})}
            resource_id={target.resource_id}
            scope_id={scope_id}
            scope_type={scope_type}
            read_only={read_only}
          />
        );
      })}
    </div>
  );
}

function PolicySkeleton() {
  return (
    <div className="grid gap-2 rounded-2xl border p-4">
      {policy_targets.map((target) => (
        <Skeleton key={target.resource_id} className="h-10 w-full" />
      ))}
    </div>
  );
}

// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { Input } from '@coworker/ui/components/input';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  filter_connection_tools,
  get_connection_preset,
  get_preset_policy_change,
  get_tool_policy_change,
  type PolicyChange,
} from '@/components/connections/connection_tool_policy_state';
import {
  build_tool_sections,
  get_section_policy_change,
} from '@/components/connections/connection_tool_sections';
import { ToolPresetMenu } from '@/components/connections/tool_permission_controls';
import { ToolPermissionGroup } from '@/components/connections/tool_permission_group';
import {
  change_tool_policies,
  list_connection_tools,
  list_tool_policies,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function ConnectionToolManagement({
  connection_id,
  read_only,
}: {
  connection_id: string;
  read_only: boolean;
}) {
  const [search_query, set_search_query] = useState('');
  const tools_query = useQuery({
    queryKey: query_keys.connection_tools(connection_id),
    queryFn: () => list_connection_tools(connection_id),
  });
  const policies_query = useQuery({
    queryKey: query_keys.tool_policies('connection', connection_id),
    queryFn: () =>
      list_tool_policies({ scope_type: 'connection', scope_id: connection_id, limit: 500 }),
  });
  const tools = tools_query.data ?? [];
  const policies = policies_query.data ?? [];
  const visible_tools = useMemo(
    () => filter_connection_tools(tools, search_query),
    [search_query, tools],
  );
  const sections = useMemo(() => build_tool_sections(tools), [tools]);
  const save = use_policy_change(connection_id);

  if (tools_query.isPending || policies_query.isPending) return <ToolManagementSkeleton />;
  if (tools_query.isError || policies_query.isError) {
    return (
      <ToolManagementError
        onRetry={() => {
          void tools_query.refetch();
          void policies_query.refetch();
        }}
      />
    );
  }

  const apply_change = (change: PolicyChange) => save.mutate(change);
  const disabled = read_only || save.isPending;
  return (
    <section className="panel p-5 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Tool management</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the tools that Alfera can use with this connection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {save.isPending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          <ToolPresetMenu
            disabled={disabled || tools.length === 0}
            value={get_connection_preset(tools, policies)}
            onChange={(preset) => apply_change(get_preset_policy_change(policies, preset))}
          />
        </div>
      </header>

      <div className="relative mt-5">
        <label className="sr-only" htmlFor="connection-tool-search">
          Search tools
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="connection-tool-search"
          className="h-10 rounded-xl pl-9"
          placeholder="Search tools"
          value={search_query}
          onChange={(event) => set_search_query(event.target.value)}
        />
      </div>

      {visible_tools.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {tools.length === 0 ? 'This connection has no tools.' : 'No tools match this search.'}
        </p>
      ) : (
        <div className="mt-3">
          {sections.map((section) => {
            const section_tools = visible_tools.filter((tool) => section.tools.includes(tool));
            if (section_tools.length === 0) return null;
            return (
              <ToolPermissionGroup
                key={section.section_key}
                description={section.description}
                disabled={disabled}
                label={section.label}
                policies={policies}
                tools={section_tools}
                onSetGroup={(mode) =>
                  apply_change(get_section_policy_change(section, tools, policies, mode))
                }
                onSetTool={(tool, mode) =>
                  apply_change(get_tool_policy_change(tool, policies, mode))
                }
              />
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        A stricter workspace or project rule still applies.
      </p>
    </section>
  );
}

function use_policy_change(connection_id: string) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (change: PolicyChange) =>
      change_tool_policies({ scope_type: 'connection', scope_id: connection_id, ...change }),
    onSuccess: () =>
      query_client.invalidateQueries({
        queryKey: query_keys.tool_policies('connection', connection_id),
      }),
    onError: (error: Error) => toast.error(error.message),
  });
}

function ToolManagementSkeleton() {
  return <Skeleton className="h-[520px] w-full rounded-2xl" />;
}

function ToolManagementError({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" className="panel w-full p-8 text-left text-destructive" onClick={onRetry}>
      The tool list could not load. Select this message to retry.
    </button>
  );
}

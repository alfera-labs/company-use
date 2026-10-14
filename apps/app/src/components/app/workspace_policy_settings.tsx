import { useQuery } from '@tanstack/react-query';
import { ToolPolicySettings } from '@/components/app/tool_policy_settings';
import { get_current_workspace } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function WorkspacePolicySettings() {
  const workspace = useQuery({ queryKey: query_keys.workspace(), queryFn: get_current_workspace });

  if (workspace.isPending) {
    return <p className="text-muted-foreground text-sm">Loading tool permissions…</p>;
  }
  if (workspace.isError) {
    return (
      <button
        type="button"
        className="text-destructive text-sm"
        onClick={() => workspace.refetch()}
      >
        The workspace could not load. Select this message to retry.
      </button>
    );
  }

  return (
    <ToolPolicySettings
      scope_type="workspace"
      scope_id={workspace.data.workspace_id}
      description="Set the workspace defaults for every project, coworker, and connection."
    />
  );
}

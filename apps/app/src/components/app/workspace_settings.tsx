import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { SettingsCard, SettingsRow } from '@coworker/ui/components/settings-card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { get_current_workspace, rename_workspace } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { WorkspaceSummary } from '@/lib/api/types';
import { copy_text } from '@/lib/copy_text';

export function WorkspaceSettings() {
  const query_client = useQueryClient();
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const [name, set_name] = useState<string | null>(null);
  const [copied, set_copied] = useState(false);

  const workspace = workspace_query.data;
  const current_name = name ?? workspace?.workspace_name ?? '';

  const rename = useMutation({
    mutationFn: (next_name: string) => rename_workspace(next_name),
    onSuccess: async (updated) => {
      set_name(null);
      query_client.setQueryData(query_keys.workspace(), updated);
      query_client.setQueryData<WorkspaceSummary[]>(query_keys.workspaces(), (workspaces) =>
        update_workspace_name_in_list(workspaces, updated),
      );
      await Promise.all([
        query_client.invalidateQueries({ queryKey: query_keys.workspace() }),
        query_client.invalidateQueries({ queryKey: query_keys.workspaces() }),
      ]);
      toast.success('Workspace renamed');
    },
    onError: (error) => toast.error(format_error_message(error, 'Rename failed')),
  });

  const copy_id = async () => {
    if (!workspace?.workspace_id) return;
    try {
      await copy_text(workspace.workspace_id);
      set_copied(true);
      setTimeout(() => set_copied(false), 1500);
    } catch (error) {
      toast.error(format_error_message(error, 'Could not copy workspace id'));
    }
  };

  const dirty = workspace ? current_name.trim() !== workspace.workspace_name : false;

  return (
    <SettingsCard>
      <SettingsRow title="Workspace name" htmlFor="workspace-name">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = current_name.trim();
            if (next && dirty) rename.mutate(next);
          }}
        >
          <Input
            id="workspace-name"
            className="w-56"
            value={current_name}
            disabled={workspace_query.isLoading}
            onChange={(event) => set_name(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!dirty || rename.isPending}>
            Save
          </Button>
        </form>
      </SettingsRow>

      <SettingsRow title="Workspace ID">
        <code className="well px-2 py-1 font-mono text-xs">{workspace?.workspace_id ?? '…'}</code>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Copy workspace id"
          disabled={!workspace?.workspace_id}
          onClick={copy_id}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

export function update_workspace_name_in_list<
  WorkspaceItem extends { workspace_id: string; workspace_name: string },
>(
  workspaces: readonly WorkspaceItem[] | undefined,
  updated: { workspace_id: string; workspace_name: string },
): WorkspaceItem[] | undefined {
  return workspaces?.map((workspace) =>
    workspace.workspace_id === updated.workspace_id
      ? { ...workspace, workspace_name: updated.workspace_name }
      : workspace,
  );
}

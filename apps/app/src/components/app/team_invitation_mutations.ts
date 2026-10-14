// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { revoke_workspace_invitation, send_workspace_invitation } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function use_send_workspace_invitation() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: send_workspace_invitation,
    onSuccess: async (invitation) => {
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_invitations() });
      toast.success(`Invitation sent to ${invitation.email}.`);
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not send the invitation')),
  });
}

export function use_revoke_workspace_invitation() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: revoke_workspace_invitation,
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_invitations() });
      toast.success('Invitation withdrawn.');
    },
    onError: (error) =>
      toast.error(format_error_message(error, 'Could not withdraw the invitation')),
  });
}

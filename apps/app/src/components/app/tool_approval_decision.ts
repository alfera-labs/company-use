// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext } from 'react';
import { toast } from 'sonner';
import { ChatActionAdapterContext } from '@/components/app/chat_action_adapter';
import {
  decide_tool_approval,
  list_tool_approvals,
  type ToolApprovalAnswer,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function use_pending_tool_approvals() {
  return useQuery({
    queryKey: query_keys.tool_approvals('waiting'),
    queryFn: list_tool_approvals,
    refetchInterval: 15_000,
  });
}

export function use_tool_approval_decision(job_id: string) {
  const query_client = useQueryClient();
  const adapter = useContext(ChatActionAdapterContext);
  return useMutation({
    mutationFn: (answer: ToolApprovalAnswer) =>
      adapter ? adapter.decide_approval(job_id, answer) : decide_tool_approval(job_id, answer),
    onSuccess: async (result, answer) => {
      if (adapter) return;
      await query_client.invalidateQueries({ queryKey: query_keys.tool_approvals() });
      toast.success(answered_message(answer, result));
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

function answered_message(answer: ToolApprovalAnswer, result: unknown) {
  if (answer.decision === 'denied') return 'Refused.';
  const remembered = (result as { remembered?: { remembered?: boolean; reason?: string } } | null)
    ?.remembered;
  if ((!answer.always_allow_subject && !answer.always_allow_tools) || remembered?.remembered) {
    return 'Approved. Picking it back up.';
  }
  return `Approved. ${could_not_remember[remembered?.reason ?? ''] ?? 'It will ask again next time.'}`;
}

const could_not_remember: Record<string, string> = {
  banned_outright: 'This is banned by a rule, so it stays an ask.',
  not_yours_to_change: 'Only a workspace admin can stop the asking, so it will ask again.',
  nothing_to_change: 'Nothing was asking about it, so there was nothing to change.',
  not_part_of_this_call: 'It will ask again next time.',
};

// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type AutomationListItem,
  type AutomationWithTriggers,
  set_automation_status,
} from '@/components/app/automations/automations_api';
import { query_keys } from '@/lib/api/query_keys';

export function use_automation_live_switch() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: ({ automation_id, live }: { automation_id: string; live: boolean }) =>
      set_automation_status(automation_id, live ? 'enabled' : 'paused'),
    onMutate: async ({ automation_id, live }) => {
      const automation_status = live ? 'enabled' : 'paused';
      const detail_key = query_keys.automation(automation_id);
      await query_client.cancelQueries({ queryKey: query_keys.automations() });
      await query_client.cancelQueries({ queryKey: detail_key });
      const before = query_client.getQueryData<AutomationListItem[]>(query_keys.automations());
      const detail_before = query_client.getQueryData<AutomationWithTriggers>(detail_key);
      query_client.setQueryData<AutomationListItem[]>(query_keys.automations(), (rows) =>
        rows?.map((row) =>
          row.automation_id === automation_id ? { ...row, automation_status } : row,
        ),
      );
      query_client.setQueryData<AutomationWithTriggers>(
        detail_key,
        (old) => old && { ...old, automation: { ...old.automation, automation_status } },
      );
      return { before, detail_before };
    },
    onError: (error, { automation_id }, context) => {
      if (context?.before) query_client.setQueryData(query_keys.automations(), context.before);
      if (context?.detail_before) {
        query_client.setQueryData(query_keys.automation(automation_id), context.detail_before);
      }
      toast.error(format_error_message(error, 'Could not change the automation'));
    },
    onSettled: (_answer, _error, { automation_id }) => {
      void query_client.invalidateQueries({ queryKey: query_keys.automations() });
      void query_client.invalidateQueries({ queryKey: query_keys.automation(automation_id) });
    },
  });
}

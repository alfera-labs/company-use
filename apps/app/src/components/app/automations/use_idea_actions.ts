// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  end_notification,
  list_automations,
  type Notification,
} from '@/components/app/automations/automations_api';
import { new_chat_draft_key } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import { query_keys } from '@/lib/api/query_keys';
import { new_chat_path } from '@/lib/website_task_request';

export function use_idea_actions() {
  const query_client = useQueryClient();
  const navigate = useNavigate();
  const automations_query = useQuery({
    queryKey: query_keys.automations(),
    queryFn: list_automations,
  });
  const dismiss = useMutation({
    mutationFn: (notification_event_id: string) =>
      end_notification(notification_event_id, 'dismiss'),
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.notifications() });
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not dismiss the idea')),
  });

  const set_it_up = (idea: Notification) => {
    const proposed = idea.notification.proposed_action;
    const named =
      proposed?.kind === 'improve_automation'
        ? automations_query.data?.find(
            (automation) => automation.automation_id === proposed.automation_id,
          )?.automation_name
        : undefined;
    useChatDraftStore.getState().set_draft(new_chat_draft_key, build_setup_request(idea, named));
    void navigate({ href: new_chat_path });
  };
  return { dismiss, set_it_up };
}

export function build_setup_request(idea: Notification, automation_name?: string): string {
  const proposed = idea.notification.proposed_action;
  if (proposed?.kind === 'offer_to_act') return `Yes, do it: ${proposed.instruction}`;
  if (proposed?.kind === 'improve_automation') {
    return `Change automation ${automation_name ?? proposed.automation_id}: ${proposed.suggestion}`;
  }
  if (proposed?.kind === 'create_automation') {
    return `${proposed.instruction}\n\n(From idea ${idea.event_id} — pass it as mined_from_notification_id.)`;
  }
  const other_offer = offer_with_instruction.safeParse(proposed);
  if (other_offer.success) return other_offer.data.instruction;
  return `Set this up as an automation: ${idea.notification.title}. ${idea.notification.body}`;
}

const offer_with_instruction = z.object({ instruction: z.string().trim().min(1) });

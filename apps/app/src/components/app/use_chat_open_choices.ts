import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { not_answerable_yet_words } from '@/components/app/chat_choice_dock';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { answer_open_choices, get_open_choices_wait } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

/** Reads the open question of a running chat and answers it from the choice panel. */
export function useChatOpenChoices(input: {
  session_id: string | undefined;
  is_runtime_active: boolean;
  is_live_socket_open: boolean;
}) {
  const { session_id } = input;
  const choice_panel_open = useChatUiStore((state) => state.choice_panel_open);
  const open_choices_query = useQuery({
    queryKey: query_keys.open_choices_wait(session_id),
    queryFn: () => get_open_choices_wait(session_id as string),
    enabled: Boolean(session_id),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (!input.is_runtime_active) return false;
      if (choice_panel_open && !query.state.data?.job_id) return 1_000;
      return input.is_live_socket_open ? false : 4_000;
    },
  });
  const choice_job_id = open_choices_query.data?.job_id;
  const answer_the_panel = useMutation({
    mutationFn: async (answer_text: string) => {
      if (!choice_job_id) throw new Error(not_answerable_yet_words);
      return answer_open_choices(choice_job_id, answer_text);
    },
    onSettled: () => void open_choices_query.refetch(),
    onError: (error) => {
      toast.message(error instanceof Error ? error.message : 'That question is no longer open.');
    },
  });
  async function answer_choice_panel(answer_text: string) {
    try {
      await answer_the_panel.mutateAsync(answer_text);
      return true;
    } catch {
      return false;
    }
  }
  return {
    choice_panel_open,
    choice_job_id,
    can_answer_choice_panel: choice_panel_open && Boolean(choice_job_id),
    answer_choice_panel,
  };
}

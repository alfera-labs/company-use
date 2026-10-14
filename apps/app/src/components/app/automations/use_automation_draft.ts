// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  type EditorValue,
  editor_is_complete,
  editor_value_from,
  editor_value_to_update_body,
  is_dirty,
  with_saved_rows,
} from '@/components/app/automations/automation_editor_model';
import {
  type AutomationWithTriggers,
  get_automation,
  provision_automation,
  type TriggerTypeCatalog,
  update_automation,
} from '@/components/app/automations/automations_api';
import { describe_first_trigger_problem } from '@/components/app/automations/trigger_problems';
import { use_new_web_call_secret } from '@/components/app/automations/web_call_address';
import { query_keys } from '@/lib/api/query_keys';

export function use_automation_draft(
  automation_id: string,
  catalog: TriggerTypeCatalog | undefined,
) {
  const automation_query = useQuery({
    queryKey: query_keys.automation(automation_id),
    queryFn: () => get_automation(automation_id),
  });
  const loaded = automation_query.data;
  const saved = loaded ? editor_value_from(loaded.automation, loaded.triggers) : null;
  const [draft, set_draft] = useState<EditorValue | null>(null);
  useEffect(() => {
    if (!loaded) return;
    set_draft((current) => current ?? editor_value_from(loaded.automation, loaded.triggers));
  }, [loaded]);
  const new_secret = use_new_web_call_secret();
  const { save, retry_trigger_setup } = use_automation_writes(
    automation_id,
    catalog,
    set_draft,
    new_secret.show_then_leave,
  );

  const value = draft ?? saved;
  const dirty = saved && draft ? is_dirty(saved, draft) : false;
  const savable = dirty && !!draft && editor_is_complete(draft, catalog);
  return {
    automation_query,
    loaded,
    value,
    set_draft,
    dirty,
    savable,
    save,
    retry_trigger_setup,
    new_secret_dialog: new_secret.dialog,
  };
}

function use_automation_writes(
  automation_id: string,
  catalog: TriggerTypeCatalog | undefined,
  set_draft: Dispatch<SetStateAction<EditorValue | null>>,
  show_then_leave: ReturnType<typeof use_new_web_call_secret>['show_then_leave'],
) {
  const query_client = useQueryClient();
  const navigate = useNavigate();
  const take_answer = async (answer: AutomationWithTriggers) => {
    query_client.setQueryData(query_keys.automation(automation_id), answer);
    await query_client.invalidateQueries({ queryKey: query_keys.automations() });
  };
  const save = useMutation({
    mutationFn: (value: EditorValue) =>
      update_automation(automation_id, editor_value_to_update_body(value, catalog)),
    // The PATCH answer does not say WHY a removal was refused, so there is no toast
    // for it; add one when the response carries the reason.
    onSuccess: async (answer) => {
      set_draft(editor_value_from(answer.automation, answer.triggers));
      await take_answer(answer);
      const problem = describe_first_trigger_problem(answer.triggers, catalog);
      if (problem) toast.error(`Saved, but ${problem}`);
      else toast.success('Saved');
      await show_then_leave(answer.triggers, () =>
        problem ? undefined : navigate({ to: '/automations' }),
      );
    },
    onError: complain('Could not save the automation'),
  });
  const retry_trigger_setup = useMutation({
    mutationFn: () => provision_automation(automation_id),
    onSuccess: async (answer) => {
      set_draft((current) => (current ? with_saved_rows(current, answer.triggers) : current));
      await take_answer(answer);
      const problem = describe_first_trigger_problem(answer.triggers, catalog);
      if (problem) toast.error(problem);
    },
    onError: complain('Could not start the trigger'),
  });
  return { save, retry_trigger_setup };
}

function complain(fallback: string) {
  return (error: unknown) => toast.error(format_error_message(error, fallback));
}

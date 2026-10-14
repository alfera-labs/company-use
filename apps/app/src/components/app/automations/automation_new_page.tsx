// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { AutomationEditor } from '@/components/app/automations/automation_editor';
import {
  type EditorValue,
  editor_is_complete,
  editor_value_to_create_body,
  empty_editor_value,
} from '@/components/app/automations/automation_editor_model';
import { AutomationTopBar } from '@/components/app/automations/automation_top_bar';
import {
  create_automation,
  list_trigger_types,
  read_notification_rules,
  type TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { describe_first_trigger_problem } from '@/components/app/automations/trigger_problems';
import { use_new_web_call_secret } from '@/components/app/automations/web_call_address';
import { query_keys } from '@/lib/api/query_keys';

export function AutomationNewPage() {
  const [value, set_value] = useState<EditorValue>(empty_editor_value);
  const policy_query = useQuery({
    queryKey: query_keys.notification_rules(),
    queryFn: read_notification_rules,
  });
  const trigger_types_query = useQuery({
    queryKey: query_keys.automation_trigger_types(),
    queryFn: list_trigger_types,
  });
  const new_secret = use_new_web_call_secret();
  const create = use_create_automation(value, trigger_types_query.data, new_secret.show_then_leave);

  const complete = editor_is_complete(value, trigger_types_query.data);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col pb-16">
      <AutomationTopBar name="New automation">
        <Button
          disabled={!complete || create.isPending}
          size="sm"
          type="button"
          onClick={() => create.mutate()}
        >
          Create
        </Button>
      </AutomationTopBar>

      <Input
        aria-label="Automation name"
        className="h-auto border-0 bg-transparent p-0 font-semibold text-2xl shadow-none focus-visible:ring-0"
        placeholder="Untitled automation"
        value={value.name}
        onChange={(event) => set_value({ ...value, name: event.target.value })}
      />

      <AutomationEditor
        value={value}
        onChange={set_value}
        triggerTypes={trigger_types_query.data}
        policy={policy_query.data?.policy}
      />
      {new_secret.dialog}
    </main>
  );
}

function use_create_automation(
  value: EditorValue,
  catalog: TriggerTypeCatalog | undefined,
  show_then_leave: ReturnType<typeof use_new_web_call_secret>['show_then_leave'],
) {
  const query_client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => create_automation(editor_value_to_create_body(value, catalog)),
    onSuccess: async (created) => {
      const problem = describe_first_trigger_problem(created.triggers, catalog);
      await query_client.invalidateQueries({ queryKey: query_keys.automations() });
      if (problem) toast.error(`Saved, but ${problem}`);
      await show_then_leave(created.triggers, () =>
        problem
          ? navigate({
              to: '/automations/$automation_id',
              params: { automation_id: created.automation.automation_id },
            })
          : navigate({ to: '/automations' }),
      );
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not create the automation')),
  });
}

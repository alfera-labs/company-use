// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { Button } from '@coworker/ui/components/button';
import { useEffect } from 'react';
import type { EditorTrigger } from '@/components/app/automations/automation_editor_model';
import type {
  AutomationTriggerInput,
  TriggerTypeApp,
} from '@/components/app/automations/automations_api';
import type { EditorPageActions } from '@/components/app/automations/connect_app_button';
import { form_connection_id } from '@/components/app/automations/trigger_account_field';
import { AccountField } from '@/components/app/automations/trigger_account_select';
import { chip_is_hidden } from '@/components/app/automations/trigger_chip_words';
import { TriggerProblem } from '@/components/app/automations/trigger_row_notes';
import {
  type SetupProblem,
  write_setup_value,
} from '@/components/app/automations/trigger_setup_answers';
import {
  SetupFieldControl,
  setup_field_id,
} from '@/components/app/automations/trigger_setup_field_control';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';
import { event_prefill } from '@/components/app/automations/trigger_setup_prefill';

export type FocusRequest = { name: string };

type SetupFormProps = {
  trigger: EditorTrigger;
  app: TriggerTypeApp | null;
  fields: SetupField[];
  problems: SetupProblem[];
  onEdit: (input: AutomationTriggerInput) => void;
};

export function TriggerSetupPanel({
  title,
  focus,
  actions,
  onDone,
  ...form
}: SetupFormProps & {
  title: string;
  focus: FocusRequest | null;
  actions: EditorPageActions | undefined;
  onDone: () => void;
}) {
  use_focus_request(form.trigger.key, focus);
  return (
    <fieldset
      aria-label={`${title} settings`}
      className="mt-3 flex min-w-0 flex-col gap-4 rounded-2xl border p-4"
    >
      <TriggerProblem trigger={form.trigger} onRetry={actions?.retry_trigger_setup} />
      <AccountField
        app={form.app}
        fields={form.fields}
        trigger={form.trigger}
        onEdit={form.onEdit}
      />
      <SetupFieldList {...form} />
      <DoneLine problems={form.problems} onDone={onDone} />
    </fieldset>
  );
}

function use_focus_request(trigger_key: string, focus: FocusRequest | null) {
  useEffect(() => {
    if (focus) document.getElementById(setup_field_id(trigger_key, focus.name))?.focus();
  }, [focus, trigger_key]);
}

function SetupFieldList({ trigger, app, fields, problems, onEdit }: SetupFormProps) {
  const input = trigger.input;
  const answers = event_prefill(input);
  const problem_of = new Map(problems.map(({ field, problem }) => [field.name, problem]));
  const node_key = input.kind === 'app_event' ? input.node_key : '';
  const connection_id =
    input.kind === 'app_event' ? form_connection_id(app, input.connection_id) : undefined;
  return fields
    .filter((field) => !chip_is_hidden(field, answers[field.name]))
    .map((field) => (
      <SetupFieldControl
        connectionId={connection_id}
        key={field.name}
        field={field}
        id={setup_field_id(trigger.key, field.name)}
        nodeKey={node_key}
        value={answers[field.name]}
        problem={problem_of.get(field.name) ?? null}
        onChange={(next) => onEdit(write_setup_value(input, field, next))}
      />
    ));
}

function DoneLine({ problems, onDone }: { problems: SetupProblem[]; onDone: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Button disabled={problems.length > 0} size="sm" type="button" onClick={onDone}>
        Done
      </Button>
      {problems.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          Fix {problems.map(({ field }) => field.label).join(', ')} first
        </span>
      ) : null}
    </div>
  );
}

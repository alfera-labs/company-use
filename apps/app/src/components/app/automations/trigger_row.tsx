import { Button } from '@coworker/ui/components/button';
import { Clock3, Globe, Plus } from 'lucide-react';
import { AppMark } from '@/components/app/app_mark';
import type { EditorTrigger } from '@/components/app/automations/automation_editor_model';
import type {
  AutomationTriggerInput,
  TriggerTypeApp,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import {
  ConnectAppButton,
  type EditorPageActions,
} from '@/components/app/automations/connect_app_button';
import { RemoveButton } from '@/components/app/automations/remove_button';
import { ScheduleChip, TriggerChips } from '@/components/app/automations/trigger_chips';
import { TriggerRowNotes } from '@/components/app/automations/trigger_row_notes';
import {
  setup_fields_of,
  setup_problems_of,
} from '@/components/app/automations/trigger_setup_answers';
import { TriggerSetupPanel } from '@/components/app/automations/trigger_setup_panel';
import {
  describe_trigger_input,
  find_trigger_type,
} from '@/components/app/automations/trigger_types_model';
import { use_setup_form_state } from '@/components/app/automations/use_setup_form_state';
import { WebCallAddressLine } from '@/components/app/automations/web_call_address';
import { relative_time } from '@/lib/api';

type TriggerRowProps = {
  trigger: EditorTrigger;
  catalog: TriggerTypeCatalog | undefined;
  actions: EditorPageActions | undefined;
  onEdit: (input: AutomationTriggerInput) => void;
  onRemove: () => void;
};

export function TriggerRow({ trigger, catalog, actions, onEdit, onRemove }: TriggerRowProps) {
  const said = describe_trigger_input(trigger.input, catalog);
  const app = app_of(trigger.input, catalog);
  const fields = setup_fields_of(trigger.input, catalog);
  const problems = setup_problems_of(trigger.input, catalog);
  const form = use_setup_form_state(trigger, fields, problems.length > 0);
  const first_field = form.open ? undefined : fields[0];

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <TriggerLogo app={app} kind={trigger.input.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <TriggerName input={trigger.input} line={said.line} onEdit={onEdit} />
          {form.open ? null : (
            <TriggerChips input={trigger.input} app={app} fields={fields} onOpen={form.open_at} />
          )}
        </div>
        <TriggerRowNotes trigger={trigger} app={app} actions={actions} form_open={form.open} />
        <WebCallAddressOfRow trigger={trigger} />
        {form.open ? (
          <TriggerSetupPanel
            title={said.line}
            trigger={trigger}
            app={app}
            fields={fields}
            problems={problems}
            focus={form.focus}
            actions={actions}
            onEdit={onEdit}
            onDone={form.close}
          />
        ) : null}
      </div>
      <TriggerRowEnd trigger={trigger} app={app} actions={actions} />
      {first_field ? (
        <Button
          aria-label={`Edit ${said.line} settings`}
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => form.open_at(first_field.name)}
        >
          Edit
        </Button>
      ) : null}
      <RemoveButton label={`Remove ${said.line}`} onClick={onRemove} />
    </div>
  );
}

function WebCallAddressOfRow({ trigger }: { trigger: EditorTrigger }) {
  if (trigger.input.kind !== 'webhook') return null;
  const address = trigger.row?.web_call_address;
  if (address) return <WebCallAddressLine address={address} />;
  return (
    <span className="block text-sm text-muted-foreground">
      Save to get its address and its secret.
    </span>
  );
}

function TriggerName({
  input,
  line,
  onEdit,
}: {
  input: AutomationTriggerInput;
  line: string;
  onEdit: (input: AutomationTriggerInput) => void;
}) {
  if (input.kind === 'schedule') return <ScheduleChip input={input} label={line} onSave={onEdit} />;
  return <span className="text-sm font-medium">{line}</span>;
}

function TriggerRowEnd({
  trigger,
  app,
  actions,
}: {
  trigger: EditorTrigger;
  app: TriggerTypeApp | null;
  actions: EditorPageActions | undefined;
}) {
  const last_run_time = trigger.row?.last_run_time;
  return (
    <>
      {last_run_time ? (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          last event {relative_time(as_iso(last_run_time))}
        </span>
      ) : null}
      {app && !app.connected ? (
        <ConnectAppButton
          app={app}
          onConnected={
            trigger.row?.trigger_status === 'error' ? actions?.retry_trigger_setup : undefined
          }
        />
      ) : null}
    </>
  );
}

function app_of(input: AutomationTriggerInput, catalog: TriggerTypeCatalog | undefined) {
  return input.kind === 'app_event'
    ? (find_trigger_type(catalog, input.node_key)?.app ?? null)
    : null;
}

function TriggerLogo({ app, kind }: { app: TriggerTypeApp | null; kind: string }) {
  if (app) return <AppMark iconUrl={app.icon_url ?? undefined} name={app.app_display_name} />;
  const Glyph = kind === 'schedule' ? Clock3 : kind === 'webhook' ? Globe : Plus;
  return <Glyph aria-hidden="true" className="mt-1 size-[17px] shrink-0 text-muted-foreground" />;
}

function as_iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

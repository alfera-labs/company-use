import { Popover, PopoverContent, PopoverTrigger } from '@coworker/ui/components/popover';
import { cn } from '@coworker/ui/lib/utils';
import { type ReactNode, useState } from 'react';
import type {
  AutomationTriggerInput,
  TriggerTypeApp,
} from '@/components/app/automations/automations_api';
import { AccountChip } from '@/components/app/automations/trigger_account_chip';
import { resolved_connection_id } from '@/components/app/automations/trigger_account_field';
import {
  type SetupFieldChipProps,
  TriggerChipButton,
} from '@/components/app/automations/trigger_chip_button';
import { chip_shell } from '@/components/app/automations/trigger_chip_shell';
import { chip_is_hidden, chip_value_for } from '@/components/app/automations/trigger_chip_words';
import { ProviderChoiceChip } from '@/components/app/automations/trigger_field_choices_chip';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';
import { ScheduleSetupForm } from '@/components/app/automations/trigger_setup_form';
import { event_prefill } from '@/components/app/automations/trigger_setup_prefill';

function SetupFieldChip(props: SetupFieldChipProps) {
  if (props.field.choices_from_provider) return <ProviderChoiceChip {...props} />;
  return (
    <TriggerChipButton
      field={props.field}
      shown={chip_value_for(props.field, props.value)}
      value={props.value}
      onOpen={props.onOpen}
    />
  );
}

export function ScheduleChip({
  input,
  label,
  onSave,
}: {
  input: AutomationTriggerInput;
  label: string;
  onSave: (input: AutomationTriggerInput) => void;
}) {
  const [open, set_open] = useState(false);
  return (
    <Popover open={open} onOpenChange={set_open}>
      <PopoverTrigger
        aria-label={`Edit ${label}`}
        className="text-start text-sm font-medium hover:underline"
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="max-h-[70vh] overflow-y-auto">
        <ScheduleSetupForm
          initial={input}
          onSave={(next) => {
            onSave(next);
            set_open(false);
          }}
          onCancel={() => set_open(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function ReadOnlyChip({ children }: { children: ReactNode }) {
  return <span className={cn(chip_shell, 'text-muted-foreground')}>{children}</span>;
}

export function TriggerChips({
  input,
  app,
  fields,
  onOpen,
}: {
  input: AutomationTriggerInput;
  app: TriggerTypeApp | null;
  fields: SetupField[];
  onOpen: (field_name: string) => void;
}) {
  if (input.kind === 'schedule') {
    return input.timezone ? <ReadOnlyChip>{input.timezone}</ReadOnlyChip> : null;
  }
  const answers = event_prefill(input);
  const connection_id =
    input.kind === 'app_event' ? resolved_connection_id(app, input.connection_id) : undefined;
  const node_key = input.kind === 'app_event' ? input.node_key : '';
  return (
    <>
      {input.kind === 'app_event' ? (
        <AccountChip app={app} connection_id={input.connection_id} onOpen={onOpen} />
      ) : null}
      {fields
        .filter((field) => !chip_is_hidden(field, answers[field.name]))
        .map((field) => (
          <SetupFieldChip
            connection_id={connection_id}
            key={field.name}
            field={field}
            node_key={node_key}
            value={answers[field.name]}
            onOpen={() => onOpen(field.name)}
          />
        ))}
    </>
  );
}

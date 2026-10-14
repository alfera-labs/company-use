import { Input } from '@coworker/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import type { TriggerFieldChoice } from '@/components/app/automations/trigger_field_choices_api';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';
import { use_trigger_field_choices } from '@/components/app/automations/use_trigger_field_choices';
import { ApiError } from '@/lib/api/client';

export type ChoiceBoxProps = {
  id: string;
  value: string | boolean | undefined;
  invalid: boolean;
  described_by: string | undefined;
  onChange: (value: string) => void;
};

export function ProviderChoiceField({
  field,
  node_key,
  connection_id,
  box,
}: {
  field: SetupField;
  node_key: string;
  connection_id: string | undefined;
  box: ChoiceBoxProps;
}) {
  const choices_query = use_trigger_field_choices(node_key, field.name, connection_id);
  if (connection_id === undefined) {
    return (
      <WaitingChoiceField
        id={box.id}
        note="Choose an account to load its options."
        placeholder="Choose an account first"
      />
    );
  }
  if (choices_query.isLoading) return <WaitingChoiceField id={box.id} placeholder="Loading…" />;
  if (choices_query.isError) {
    return <TypedChoiceField box={box} message={failure_words(choices_query.error)} />;
  }
  if ((choices_query.data ?? []).length === 0) {
    return (
      <TypedChoiceField box={box} message="Nothing to pick from this account. Type it instead." />
    );
  }
  return <LoadedChoiceField box={box} choices={with_default_choice(field, choices_query.data)} />;
}

function with_default_choice(
  field: SetupField,
  choices: TriggerFieldChoice[] | undefined,
): TriggerFieldChoice[] {
  const loaded = choices ?? [];
  const fallback = field.has_default ? field.default_value : null;
  if (typeof fallback !== 'string' || !fallback) return loaded;
  if (loaded.some((choice) => choice.value === fallback)) return loaded;
  return [{ value: fallback, label: `Default (${fallback})` }, ...loaded];
}

function LoadedChoiceField({
  box,
  choices,
}: {
  box: ChoiceBoxProps;
  choices: TriggerFieldChoice[];
}) {
  return (
    <Select
      // `items` makes the closed box say the option's label, not the provider's id.
      items={Object.fromEntries(choices.map((choice) => [choice.value, choice.label]))}
      value={typeof box.value === 'string' ? box.value : ''}
      onValueChange={(next) => next && box.onChange(next)}
    >
      <SelectTrigger
        aria-describedby={box.described_by}
        aria-invalid={box.invalid}
        className="rounded-xl"
        id={box.id}
      >
        <SelectValue placeholder="Pick one" />
      </SelectTrigger>
      <SelectContent className="w-auto min-w-(--anchor-width)">
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WaitingChoiceField({
  id,
  placeholder,
  note,
}: {
  id: string;
  placeholder: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Select disabled value="">
        <SelectTrigger className="rounded-xl" id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent />
      </Select>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function TypedChoiceField({ box, message }: { box: ChoiceBoxProps; message: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-describedby={box.described_by}
        aria-invalid={box.invalid}
        className="rounded-xl"
        id={box.id}
        value={typeof box.value === 'string' ? box.value : ''}
        onChange={(event) => box.onChange(event.target.value)}
      />
      <p className="text-xs text-caution-ink">{message}</p>
    </div>
  );
}

function failure_words(error: unknown) {
  return error instanceof ApiError ? error.message : 'Could not load the options.';
}

import { Checkbox } from '@coworker/ui/components/checkbox';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import {
  type ChoiceBoxProps,
  ProviderChoiceField,
} from '@/components/app/automations/provider_choice_field';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';

export function setup_field_id(trigger_key: string, field_name: string): string {
  return `trigger-setup-${trigger_key}-${field_name}`;
}

type SetupFieldProps = {
  field: SetupField;
  id: string;
  value: string | boolean | undefined;
  problem: string | null;
  onChange: (value: string | boolean) => void;
  nodeKey: string;
  connectionId: string | undefined;
};

export function SetupFieldControl(props: SetupFieldProps) {
  const { field, id, problem } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required ? (
          <span className="text-xs font-normal text-muted-foreground">Required</span>
        ) : null}
      </Label>
      <SetupFieldBox {...props} />
      {field.description ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
      {problem ? (
        <p className="text-xs text-caution-ink" id={`${id}-problem`}>
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function SetupFieldBox({
  field,
  id,
  value,
  problem,
  onChange,
  nodeKey,
  connectionId,
}: SetupFieldProps) {
  const invalid = problem !== null;
  const box: ChoiceBoxProps = {
    id,
    value,
    invalid,
    described_by: invalid ? `${id}-problem` : undefined,
    onChange,
  };
  if (field.choices_from_provider) {
    return (
      <ProviderChoiceField
        box={box}
        connection_id={connectionId}
        field={field}
        node_key={nodeKey}
      />
    );
  }
  if (field.choices) return <StaticChoiceSelect box={box} choices={field.choices} />;
  if (field.type === 'boolean') {
    return <Checkbox id={id} checked={value === true} onCheckedChange={onChange} />;
  }
  return <TextBox box={box} field={field} />;
}

function StaticChoiceSelect({ box, choices }: { box: ChoiceBoxProps; choices: string[] }) {
  return (
    <Select
      value={typeof box.value === 'string' ? box.value : ''}
      onValueChange={(choice) => box.onChange(choice ?? '')}
    >
      <SelectTrigger
        aria-describedby={box.described_by}
        aria-invalid={box.invalid}
        className="rounded-xl"
        id={box.id}
      >
        <SelectValue placeholder="Pick one" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice} value={choice}>
            {choice}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TextBox({ box, field }: { box: ChoiceBoxProps; field: SetupField }) {
  return (
    <Input
      aria-describedby={box.described_by}
      aria-invalid={box.invalid}
      className="rounded-xl"
      id={box.id}
      type={field.type === 'number' ? 'number' : 'text'}
      {...number_bounds(field)}
      value={typeof box.value === 'boolean' ? '' : (box.value ?? '')}
      onChange={(event) => box.onChange(event.target.value)}
    />
  );
}

function number_bounds(field: SetupField) {
  if (field.type !== 'number') return {};
  return {
    min: field.minimum ?? undefined,
    max: field.maximum ?? undefined,
    step: field.multiple_of ?? (field.whole_number ? 1 : 'any'),
  };
}

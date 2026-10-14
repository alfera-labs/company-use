import { Label } from '@coworker/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import type { EditorTrigger } from '@/components/app/automations/automation_editor_model';
import type {
  AutomationTriggerInput,
  TriggerTypeApp,
} from '@/components/app/automations/automations_api';
import {
  account_words,
  app_has_many_connections,
  write_connection_id,
} from '@/components/app/automations/trigger_account_field';
import { setup_field_id } from '@/components/app/automations/trigger_setup_field_control';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';

export function AccountField({
  app,
  trigger,
  fields,
  onEdit,
}: {
  app: TriggerTypeApp | null;
  trigger: EditorTrigger;
  fields: SetupField[];
  onEdit: (input: AutomationTriggerInput) => void;
}) {
  if (trigger.input.kind !== 'app_event' || !app_has_many_connections(app)) return null;
  const input = trigger.input;
  const connections = app?.connections ?? [];
  const id = setup_field_id(trigger.key, 'connection_id');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Account</Label>
      <Select
        // `items` makes the closed box say the account's name, not its id.
        items={Object.fromEntries(
          connections.map((one) => [one.connection_id, account_words(one)]),
        )}
        value={input.connection_id ?? ''}
        onValueChange={(connection_id) => {
          if (connection_id) onEdit(write_connection_id(input, connection_id, fields));
        }}
      >
        <SelectTrigger className="rounded-xl" id={id}>
          <SelectValue placeholder="Pick an account" />
        </SelectTrigger>
        <SelectContent className="w-auto min-w-(--anchor-width)">
          {connections.map((connection) => (
            <SelectItem key={connection.connection_id} value={connection.connection_id}>
              <span className="flex flex-col">
                <span>{account_words(connection)}</span>
                {connection.account_label &&
                connection.connection_name !== connection.account_label ? (
                  <span className="text-xs text-muted-foreground">
                    {connection.connection_name}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

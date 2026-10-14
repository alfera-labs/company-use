import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import {
  ConnectionAudienceField,
  connection_sharing_query,
} from '@/components/connections/connection_audience_field';
import { ConnectionPeople } from '@/components/connections/connection_members';
import { use_connection_actions } from '@/components/connections/use_connection_actions';
import type { Connection } from '@/lib/api/types';

export function ConnectionSettings({ connection }: { connection: Connection }) {
  const sharing = useQuery(connection_sharing_query(connection.connection_id));
  const [name, set_name] = useState(connection.connection_name ?? '');
  const actions = use_connection_actions(connection);
  return (
    <section className="panel grid gap-5 p-5">
      <header>
        <h2 className="text-sm font-semibold">Connection settings</h2>
        <p className="mt-1 text-xs text-muted-foreground">Change the name and who can use it.</p>
      </header>
      <ConnectionNameField
        current_name={connection.connection_name}
        disabled={actions.is_saving}
        is_renaming={actions.is_renaming}
        name={name}
        onChange={set_name}
        onSave={() => actions.rename(name)}
      />
      <ConnectionAudienceField connection={connection} />
      {sharing.data ? (
        <ConnectionPeople connection_id={connection.connection_id} sharing={sharing.data} />
      ) : null}
    </section>
  );
}

function ConnectionNameField({
  current_name,
  disabled,
  is_renaming,
  name,
  onChange,
  onSave,
}: {
  current_name: string | null;
  disabled: boolean;
  is_renaming: boolean;
  name: string;
  onChange: (name: string) => void;
  onSave: () => void;
}) {
  const input_id = useId();
  const saved_name = current_name ?? '';
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={input_id}>Name</Label>
      <div className="flex gap-2">
        <Input
          id={input_id}
          value={name}
          disabled={disabled}
          placeholder="My account"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !name.trim() || name.trim() === saved_name}
          onClick={onSave}
        >
          {is_renaming ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}

import { cn } from '@coworker/ui/lib/utils';
import type { TriggerTypeApp } from '@/components/app/automations/automations_api';
import {
  account_name,
  app_has_many_connections,
} from '@/components/app/automations/trigger_account_field';
import { chip_shell } from '@/components/app/automations/trigger_chip_shell';

export function AccountChip({
  app,
  connection_id,
  onOpen,
}: {
  app: TriggerTypeApp | null;
  connection_id: string | undefined;
  onOpen: (field_name: string) => void;
}) {
  if (!app_has_many_connections(app)) return null;
  const name = account_name(app, connection_id);
  return (
    <button
      aria-label={`Account: ${name}`}
      className={cn(chip_shell, 'hover:bg-hover')}
      type="button"
      onClick={() => onOpen('connection_id')}
    >
      <span className="text-muted-foreground">account</span>
      <span className="text-muted-foreground">·</span>
      <span className="truncate">{name}</span>
    </button>
  );
}

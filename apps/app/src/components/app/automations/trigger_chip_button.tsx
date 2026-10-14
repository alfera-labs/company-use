import { cn } from '@coworker/ui/lib/utils';
import { chip_shell } from '@/components/app/automations/trigger_chip_shell';
import { chip_word_for } from '@/components/app/automations/trigger_chip_words';
import type { SetupField } from '@/components/app/automations/trigger_setup_fields';

export type SetupFieldChipProps = {
  field: SetupField;
  value: string | boolean | undefined;
  node_key: string;
  connection_id: string | undefined;
  onOpen: () => void;
};

export function TriggerChipButton({
  field,
  shown,
  value,
  onOpen,
}: {
  field: SetupField;
  shown: string;
  value: string | boolean | undefined;
  onOpen: () => void;
}) {
  return (
    <button
      aria-label={`${field.label}: ${shown}`}
      className={cn(chip_shell, 'hover:bg-hover')}
      type="button"
      onClick={onOpen}
    >
      <span className="text-muted-foreground">{chip_word_for(field)}</span>
      <span className="text-muted-foreground">·</span>
      <span
        className={cn('truncate', {
          'text-muted-foreground': !value && value !== false,
        })}
      >
        {shown}
      </span>
    </button>
  );
}

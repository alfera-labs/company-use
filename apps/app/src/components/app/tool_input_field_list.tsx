import type { ToolInputField } from '@coworker/shared';
import { cn } from '@coworker/ui/lib/utils';

export function ToolInputFieldList({
  className,
  fields,
}: {
  className?: string | undefined;
  fields: ToolInputField[];
}) {
  if (fields.length === 0) return null;

  return (
    <dl className={cn('grid gap-1.5 text-[13px]', className)}>
      {fields.map((field) => (
        <div
          className={field.is_long ? 'grid gap-1' : 'grid grid-cols-[6.75rem_minmax(0,1fr)] gap-3'}
          key={field.key}
        >
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd
            className={
              field.is_long
                ? 'max-h-56 overflow-y-auto whitespace-pre-wrap border-border border-l-2 pl-2.5 text-foreground/85'
                : 'min-w-0 break-words text-foreground/90'
            }
          >
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

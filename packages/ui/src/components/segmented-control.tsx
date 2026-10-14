'use client';

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cn } from '@coworker/ui/lib/utils';

function SegmentedControl<Value extends string>({
  value,
  onValueChange,
  className,
  ...props
}: Omit<ToggleGroupPrimitive.Props<Value>, 'value' | 'onValueChange' | 'multiple'> & {
  value: Value;
  onValueChange: (value: Value) => void;
}) {
  return (
    <ToggleGroupPrimitive<Value>
      data-slot="segmented-control"
      value={[value]}
      onValueChange={(next_values) => {
        const next_value = next_values[0];
        if (next_value !== undefined) onValueChange(next_value);
      }}
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-2xl bg-sunken p-[3px] shadow-[inset_0_0_0_1px_var(--border)]',
        className,
      )}
      {...props}
    />
  );
}

function SegmentedControlItem({ className, ...props }: TogglePrimitive.Props<string>) {
  return (
    <TogglePrimitive
      data-slot="segmented-control-item"
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,box-shadow] duration-150 ease-out-quart select-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 data-pressed:bg-raised data-pressed:text-foreground data-pressed:shadow-[0_0_0_1px_var(--border),var(--elevation-1)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };

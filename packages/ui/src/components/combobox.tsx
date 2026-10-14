'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { cn } from '@coworker/ui/lib/utils';

const Combobox = ComboboxPrimitive.Root;
const ComboboxPortal = ComboboxPrimitive.Portal;
const ComboboxGroup = ComboboxPrimitive.Group;

function ComboboxTrigger({ className, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        'min-w-0 text-foreground transition-colors duration-150 ease-out-quart outline-none hover:bg-hover focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxPositioner({ className, ...props }: ComboboxPrimitive.Positioner.Props) {
  return (
    <ComboboxPrimitive.Positioner
      data-slot="combobox-positioner"
      className={cn('z-dropdown', className)}
      {...props}
    />
  );
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Popup
      data-slot="combobox-popup"
      className={cn(
        't-dropdown rounded-2xl bg-popover text-popover-foreground shadow-float ring-1 ring-strong',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        'h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-1', className)}
      {...props}
    />
  );
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'row-interactive min-h-7.5 cursor-default justify-between rounded-xl px-2 py-1 text-sm text-foreground outline-none select-none',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={className}
      {...props}
    />
  );
}

// Base UI keeps this element mounted even when the list has results, so screen readers can
// announce the change. Any box on the root is therefore permanent blank space above the list:
// style the children instead, which only exist when the list is actually empty.
function ComboboxEmpty({ className, children, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty data-slot="combobox-empty" className={className} {...props}>
      {children === undefined ? null : (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</div>
      )}
    </ComboboxPrimitive.Empty>
  );
}

export {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
};

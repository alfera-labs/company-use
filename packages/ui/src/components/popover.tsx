'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@coworker/ui/lib/utils';

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-dropdown"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            't-dropdown z-dropdown rounded-2xl bg-popover p-3 text-popover-foreground shadow-float ring-1 ring-border outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-xs text-muted-foreground text-pretty', className)}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverDescription, PopoverTrigger };

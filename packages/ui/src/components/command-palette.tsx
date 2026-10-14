'use client';

import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@coworker/ui/lib/utils';
import type * as React from 'react';

const CommandPalette = DialogPrimitive.Root;
const CommandPaletteAutocomplete = AutocompletePrimitive.Root;
const CommandPaletteGroup = AutocompletePrimitive.Group;
const CommandPaletteCollection = AutocompletePrimitive.Collection;

function CommandPaletteSurface({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="command-palette-backdrop"
        className="fixed inset-0 z-overlay bg-scrim transition-opacity duration-150 ease-out-quart data-closed:opacity-0 data-open:opacity-100 motion-reduce:transition-none"
      />
      <DialogPrimitive.Viewport className="fixed inset-0 z-overlay flex items-start justify-center p-4 pt-[10vh] sm:pt-[14vh]">
        <DialogPrimitive.Popup
          data-slot="command-palette"
          className={cn(
            'flex w-full max-w-[40rem] origin-top flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-overlay ring-1 ring-border outline-none',
            'transition-[opacity,transform] duration-150 ease-out data-closed:scale-[0.98] data-closed:opacity-0 data-open:scale-100 data-open:opacity-100 motion-reduce:transition-none',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function CommandPaletteInputRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-palette-input-row"
      className={cn('flex items-center border-border border-b px-4', className)}
      {...props}
    />
  );
}

function CommandPaletteInput({ className, ...props }: AutocompletePrimitive.Input.Props) {
  return (
    <AutocompletePrimitive.Input
      data-slot="command-palette-input"
      className={cn(
        'h-14 w-full bg-transparent text-lg outline-none placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CommandPaletteList({ className, ...props }: AutocompletePrimitive.List.Props) {
  return (
    <AutocompletePrimitive.List
      data-slot="command-palette-list"
      className={cn(
        'max-h-[min(34rem,65vh)] min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-4',
        className,
      )}
      {...props}
    />
  );
}

function CommandPaletteGroupLabel({ className, ...props }: AutocompletePrimitive.GroupLabel.Props) {
  return (
    <AutocompletePrimitive.GroupLabel
      data-slot="command-palette-group-label"
      className={cn(
        'sticky top-0 z-10 bg-popover px-3 py-2 font-medium text-muted-foreground text-sm',
        className,
      )}
      {...props}
    />
  );
}

function CommandPaletteItem({ className, ...props }: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="command-palette-item"
      className={cn(
        'row-interactive mb-1 flex cursor-default select-none items-start gap-3 rounded-2xl border border-transparent px-3 py-2 text-sm outline-none hover:bg-muted/45 data-highlighted:border-border data-highlighted:bg-muted/60',
        className,
      )}
      {...props}
    />
  );
}

// Base UI keeps this element mounted so screen readers announce the change, so any padding on
// the root would be permanent blank space above the list. Style the children instead — they
// exist only when the list is genuinely empty. Same reasoning as the combobox.
function CommandPaletteEmpty({ className, children, ...props }: AutocompletePrimitive.Empty.Props) {
  return (
    <AutocompletePrimitive.Empty data-slot="command-palette-empty" className={className} {...props}>
      {children === undefined ? null : (
        <div className="px-3 py-10 text-center text-muted-foreground text-sm">{children}</div>
      )}
    </AutocompletePrimitive.Empty>
  );
}

function CommandPaletteFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-palette-footer"
      className={cn(
        'flex items-center gap-4 border-border border-t px-4 py-2.5 text-muted-foreground text-xs',
        className,
      )}
      {...props}
    />
  );
}

export {
  CommandPalette,
  CommandPaletteAutocomplete,
  CommandPaletteCollection,
  CommandPaletteEmpty,
  CommandPaletteFooter,
  CommandPaletteGroup,
  CommandPaletteGroupLabel,
  CommandPaletteInput,
  CommandPaletteInputRow,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteSurface,
};

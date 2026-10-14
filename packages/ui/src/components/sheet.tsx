'use client';

import { Dialog } from '@base-ui/react/dialog';
import { buttonVariants } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { X } from 'lucide-react';
import type * as React from 'react';

const Sheet = Dialog.Root;
const SheetTrigger = Dialog.Trigger;
const SheetClose = Dialog.Close;

function SheetContent({ className, children, ...props }: Dialog.Popup.Props) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-overlay bg-scrim" />
      <Dialog.Viewport className="fixed inset-0 z-overlay flex justify-end">
        <Dialog.Popup
          data-slot="sheet-content"
          className={cn(
            'relative flex h-dvh w-full max-w-xl flex-col bg-popover text-popover-foreground shadow-overlay ring-1 ring-border outline-none',
            className,
          )}
          {...props}
        >
          {children}
          <Dialog.Close
            aria-label="Close panel"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              'absolute right-4 top-4',
            )}
          >
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('shrink-0 space-y-1 border-b px-6 py-5 pr-14', className)} {...props} />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'shrink-0 border-t bg-popover px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: Dialog.Title.Props) {
  return (
    <Dialog.Title className={cn('text-lg font-semibold text-balance', className)} {...props} />
  );
}

function SheetDescription({ className, ...props }: Dialog.Description.Props) {
  return (
    <Dialog.Description
      className={cn('text-sm text-muted-foreground text-pretty', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};

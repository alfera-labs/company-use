import { cn } from '@coworker/ui/lib/utils';
import type * as React from 'react';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center rounded border border-border/70 bg-muted px-1.5 font-medium font-sans text-[11px] text-muted-foreground leading-none',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };

import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '@coworker/ui/lib/utils';
import type * as React from 'react';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'field h-8 w-full min-w-0 px-2.5 py-1 text-base file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground md:text-sm',
        'aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] aria-invalid:focus-visible:shadow-[inset_0_0_0_1px_var(--destructive),0_0_0_3px_color-mix(in_oklch,var(--destructive)_25%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export { Input };

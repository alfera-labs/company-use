import { cn } from '@coworker/ui/lib/utils';
import type * as React from 'react';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field flex field-sizing-content min-h-16 w-full resize-none rounded-2xl px-2.5 py-2 text-base md:text-sm',
        'aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] aria-invalid:focus-visible:shadow-[inset_0_0_0_1px_var(--destructive),0_0_0_3px_color-mix(in_oklch,var(--destructive)_25%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

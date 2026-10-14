import { cn } from '@coworker/ui/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-2xl bg-sunken', className)}
      {...props}
    />
  );
}

export { Skeleton };

import { Skeleton } from '@coworker/ui/components/skeleton';
import { cn } from '@coworker/ui/lib/utils';
import type { ReactNode } from 'react';
import { AppContentArea } from '@/components/app/app_content_area';

export function PageLoadingFrame({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AppContentArea>
      <main className={cn('mx-auto flex w-full flex-col pb-10', className)}>
        <h1 className="mt-1 text-xl font-semibold text-balance">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
        <div className="mt-7 flex flex-col gap-5">{children}</div>
      </main>
    </AppContentArea>
  );
}

export function TabStripSkeleton({ labels }: { labels: string[] }) {
  return (
    <div className="flex gap-4 border-b border-border pb-2 text-sm text-muted-foreground">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

export function CardRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid gap-x-12 gap-y-2 md:grid-cols-2">
      {skeleton_row_keys(rows).map((key) => (
        <div
          className="grid grid-cols-[44px_minmax(0,1fr)_32px] items-center gap-3 px-2 py-2"
          key={key}
        >
          <Skeleton className="size-10 rounded-3xl" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-60 max-w-full" />
          </div>
          <Skeleton className="size-8 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function skeleton_row_keys(count: number) {
  return Array.from({ length: count }, (_, index) => `skeleton-row-${index}`);
}

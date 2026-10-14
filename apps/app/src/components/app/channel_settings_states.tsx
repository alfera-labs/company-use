import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Loader2, RefreshCw } from 'lucide-react';

const loading_rows = ['one', 'two', 'three', 'four', 'five'];

export function ChannelLoadMoreButton({
  isFetchingMore,
  onLoadMore,
}: {
  isFetchingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="border-t border-border p-3">
      <Button
        className="w-full"
        type="button"
        size="sm"
        variant="outline"
        disabled={isFetchingMore}
        onClick={onLoadMore}
      >
        {isFetchingMore ? <Loader2 className="size-4 animate-spin" /> : null}
        Load more
      </Button>
    </div>
  );
}

export function ChannelLoadingRows() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      {loading_rows.map((key) => (
        <div
          key={key}
          className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
        >
          <Skeleton className="size-8 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="size-5 rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

export function ChannelError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-4 text-sm text-destructive">
      <span>{error.message || 'Channels unavailable'}</span>
      <Button size="sm" type="button" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Retry
      </Button>
    </div>
  );
}

export function ChannelEmptyState({
  search,
  totalLoaded,
}: {
  search: string;
  totalLoaded: number;
}) {
  const message =
    search.trim().length > 0
      ? `No channels match "${search}".`
      : totalLoaded === 0
        ? 'No channels found.'
        : 'No visible channels.';

  return (
    <div className="rounded-2xl border border-border px-4 py-8 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

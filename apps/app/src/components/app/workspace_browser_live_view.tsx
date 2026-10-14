import { Button } from '@coworker/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserLiveViewport } from '@/components/app/browser_live_view/browser_live_viewport';
import type { BrowserTask } from '@/components/app/browser_live_view/browser_task_controls';
import { start_session_browser } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function WorkspaceBrowserLiveView({
  session_id,
  browser_task,
}: {
  session_id: string | undefined;
  browser_task?: BrowserTask | undefined;
}) {
  const [retry_attempt, set_retry_attempt] = useState(0);
  const retry_browser = () => set_retry_attempt((current) => current + 1);
  const browser_query = useQuery({
    queryKey: query_keys.session_browser(session_id, retry_attempt),
    queryFn: ({ signal }) => start_session_browser(session_id ?? '', signal),
    enabled: Boolean(session_id),
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  if (!session_id) {
    return <p className="p-6 text-sm text-muted-foreground">Start a chat to open its browser.</p>;
  }
  if (browser_query.isPending) {
    return (
      <div
        role="status"
        className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="size-3 motion-safe:animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
        />
        Starting the browser…
      </div>
    );
  }
  if (!browser_query.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          Could not start the browser. {browser_query.error?.message}
        </p>
        <Button variant="outline" onClick={retry_browser}>
          Retry browser
        </Button>
      </div>
    );
  }
  return (
    <>
      {browser_query.isError ? (
        <div className="flex items-center gap-2 border-b border-border p-3">
          <p role="alert" className="flex-1 text-xs text-destructive">
            Could not refresh the browser connection. {browser_query.error.message}
          </p>
          <Button variant="outline" onClick={retry_browser}>
            Retry browser
          </Button>
        </div>
      ) : null}
      <BrowserLiveViewport
        key={`${session_id}:${retry_attempt}:${browser_query.data.preview_url}:${browser_query.data.live_view_token}`}
        preview={browser_query.data}
        on_retry={retry_browser}
        browser_task={browser_task}
      />
    </>
  );
}

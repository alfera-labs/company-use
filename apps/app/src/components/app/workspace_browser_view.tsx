import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Eye } from 'lucide-react';
import { useState } from 'react';
import type { BrowserTask } from '@/components/app/browser_live_view/browser_task_controls';
import { without_browser_live_view } from '@/components/app/chat_browser_panel';
import { WorkspaceBrowserLiveView } from '@/components/app/workspace_browser_live_view';
import { is_image_file } from '@/components/app/workspace_file_visuals';
import type { SandboxUrlPreview, WorkspaceFileEntry } from '@/lib/api';
import { list_workspace_files, workspace_file_download_url } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function WorkspaceBrowserView({
  previews,
  session_id,
  browser_task,
}: {
  previews: SandboxUrlPreview[];
  session_id: string | undefined;
  browser_task?: BrowserTask | undefined;
}) {
  const [selected_source, set_selected_source] = useState<string | null>(null);

  const files_query = useQuery({
    queryFn: () => list_workspace_files('files'),
    queryKey: query_keys.workspace_files('files'),
    refetchInterval: 3000,
  });
  const latest_screenshot = find_latest_image(files_query.data?.files ?? []);

  const sources: BrowserSource[] = [
    { source_id: 'browser', label: 'Live browser', kind: 'browser', url: '' },
    ...without_browser_live_view(previews).map((preview) => ({
      source_id: preview.sandbox_url_preview_id,
      label: preview.preview_name,
      kind: 'live' as const,
      url: preview.preview_url,
    })),
    ...(latest_screenshot
      ? [
          {
            source_id: 'alfera-view',
            label: "Alfera's view",
            kind: 'screenshot' as const,
            url: workspace_file_download_url(`files/${latest_screenshot.file_name}`),
            captured_time: latest_screenshot.last_modified_time,
          },
        ]
      : []),
  ];
  const selected = sources.find((source) => source.source_id === selected_source) ?? sources[0];

  if (!selected) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sources.length > 1 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
          {sources.map((source) => (
            <button
              className={cn(
                'flex h-7 max-w-56 shrink-0 items-center gap-1.5 truncate rounded-2xl border px-2.5 text-xs font-medium',
                source.source_id === selected.source_id
                  ? 'border-border bg-sunken text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-hover',
              )}
              key={source.source_id}
              title={source.url}
              type="button"
              onClick={() => set_selected_source(source.source_id)}
            >
              {source.kind === 'screenshot' ? <Eye className="size-3.5 shrink-0" /> : null}
              {source.label}
            </button>
          ))}
          <div className="flex-1" />
          {selected.kind === 'live' ? (
            <Button
              aria-label="Open in a new tab"
              className="size-7 shrink-0"
              size="icon-sm"
              variant="ghost"
              render={
                <a href={selected.url} rel="noreferrer" target="_blank">
                  <ExternalLink />
                </a>
              }
            />
          ) : null}
        </div>
      ) : null}
      {selected.kind === 'browser' ? (
        <WorkspaceBrowserLiveView session_id={session_id} browser_task={browser_task} />
      ) : selected.kind === 'live' ? (
        <iframe
          className="min-h-0 w-full flex-1 bg-white"
          src={selected.url}
          title={selected.label}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-sunken p-3">
          <img
            alt="The most recent page Alfera's browser captured"
            className="w-full rounded-2xl border border-border bg-white object-contain"
            src={selected.url}
          />
          {selected.captured_time ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              What Alfera last saw · {format_captured_time(selected.captured_time)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

type BrowserSource = {
  source_id: string;
  label: string;
  kind: 'browser' | 'live' | 'screenshot';
  url: string;
  captured_time?: string | null;
};

function find_latest_image(files: WorkspaceFileEntry[]) {
  return files
    .filter((file) => is_image_file(file.file_name))
    .sort((a, b) => (b.last_modified_time ?? '').localeCompare(a.last_modified_time ?? ''))[0];
}

function format_captured_time(iso_time: string) {
  return new Date(iso_time).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

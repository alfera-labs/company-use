import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { FileText, LoaderCircle, X } from 'lucide-react';
import { ArtifactContentRenderer } from '@/components/app/artifact_renderers';
import type { ChatThreadProjectionItem } from '@/components/app/chat_stream_projection';
import { Markdown } from '@/components/prompt-kit/markdown';
import { open_artifact_content } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function ChatArtifactPanel({
  artifactId,
  liveArtifact,
  onClose,
}: {
  artifactId: string;
  liveArtifact?: ChatThreadProjectionItem;
  onClose: () => void;
}) {
  const artifact_query = useQuery({
    enabled: !liveArtifact,
    queryKey: query_keys.artifact_content(artifactId),
    queryFn: () => open_artifact_content(artifactId),
  });
  const artifact = artifact_query.data?.file;
  const title =
    liveArtifact?.title ?? artifact?.file_name ?? artifact?.workspace_path ?? 'Artifact';
  const status = liveArtifact?.item_status === 'streaming' ? 'Generating...' : 'Ready';
  const kind = liveArtifact?.file_purpose ?? artifact?.file_purpose;

  return (
    <aside className="flex min-h-0 w-full flex-col border-l border-border bg-background xl:min-w-[520px] xl:max-w-[50vw]">
      <header className="flex h-app-header min-h-12 items-center gap-3 border-b border-border px-4">
        <Button
          aria-label="Close artifact"
          className="size-8 shrink-0"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={onClose}
        >
          <X />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {liveArtifact?.item_status === 'streaming' ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <FileText className="size-3" />
            )}
            <span>{status}</span>
            {kind ? <span className="text-muted-foreground">&middot; {kind}</span> : null}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-8 py-10 md:px-12">
        {liveArtifact ? <LiveArtifactContent item={liveArtifact} /> : null}
        {!liveArtifact && artifact_query.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Opening artifact...
          </div>
        ) : null}
        {!liveArtifact && artifact_query.isError ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Artifact bytes are missing.
          </div>
        ) : null}
        {!liveArtifact && artifact_query.data ? (
          <ArtifactContentRenderer content={artifact_query.data} />
        ) : null}
      </div>
    </aside>
  );
}

function LiveArtifactContent({ item }: { item: ChatThreadProjectionItem }) {
  const content = item.content ?? item.content_preview ?? '';
  if (!content) return <div className="text-sm text-muted-foreground">Waiting for content...</div>;

  if (item.file_purpose === 'code') {
    return (
      <pre className="overflow-auto rounded-2xl border border-border bg-sunken p-4 text-sm">
        {content}
      </pre>
    );
  }

  return (
    <article
      className={cn(
        'prose dark:prose-invert relative min-w-full bg-transparent p-0',
        'max-w-3xl prose-h1:mb-5 prose-h1:text-4xl prose-h1:leading-tight prose-h2:mt-8 prose-h2:text-2xl prose-p:my-4 prose-p:leading-7 prose-li:my-1.5',
      )}
    >
      <Markdown>{content}</Markdown>
    </article>
  );
}

import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { skipToken, useQuery } from '@tanstack/react-query';
import { Ellipsis, FileText } from 'lucide-react';
import { useContext } from 'react';
import { toast } from 'sonner';
import { ArtifactContentBody } from '@/components/app/artifact_renderers';
import { ChatActionAdapterContext } from '@/components/app/chat_action_adapter';
import type { ProjectedChatMessagePart } from '@/components/app/chat_stream_projection';
import { WorkspaceFileDocument } from '@/components/app/workspace_file_document';
import { Markdown } from '@/components/prompt-kit/markdown';
import { type ArtifactContent, open_artifact_content } from '@/lib/api';
import { download_file } from '@/lib/api/download_file';
import { query_keys } from '@/lib/api/query_keys';

type ArtifactPart = Extract<ProjectedChatMessagePart, { type: 'artifact' }>;

export function ChatArtifactCard({
  onOpen,
  part,
}: {
  onOpen?: (file_id: string) => void;
  part: ArtifactPart;
}) {
  const adapter = useContext(ChatActionAdapterContext);
  const read_artifact = adapter ? adapter.read_artifact : open_artifact_content;
  const content_query = useQuery({
    enabled: !part.contentPreview,
    queryKey: query_keys.artifact_content(part.artifactId),
    queryFn: read_artifact ? () => read_artifact(part.artifactId) : skipToken,
    staleTime: 60_000,
  });
  const file_name = part.title ?? content_query.data?.file?.file_name;
  const extension = file_extension(file_name);

  return (
    <div className="w-full max-w-md overflow-hidden rounded-[24px] bg-raised shadow-raised ring-1 ring-border/60">
      {content_query.isError ? null : (
        <ArtifactPreview
          content={content_query.data}
          isLoading={content_query.isLoading || (!part.contentPreview && !read_artifact)}
          part={part}
        />
      )}
      <ArtifactFileRow
        artifactId={part.artifactId}
        extension={extension}
        name={file_name ?? 'Artifact'}
        {...(part.kind ? { kind: part.kind } : {})}
        {...(onOpen ? { onOpen } : {})}
      />
    </div>
  );
}

function ArtifactPreview({
  content,
  isLoading,
  part,
}: {
  content: ArtifactContent | undefined;
  isLoading: boolean;
  part: ArtifactPart;
}) {
  const preview_path = part.title ?? content?.file?.file_name ?? '';
  const is_delimited = ['csv', 'tsv'].includes(file_extension(preview_path));
  return (
    <div className="block max-h-[260px] w-full overflow-hidden px-6 pt-6 text-left mask-b-from-70% mask-b-to-100%">
      <div style={{ zoom: 0.72 }}>
        {part.contentPreview && is_delimited ? (
          <WorkspaceFileDocument content_text={part.contentPreview} file_path={preview_path} />
        ) : null}
        {part.contentPreview && !is_delimited ? (
          <article className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown>{part.contentPreview}</Markdown>
          </article>
        ) : null}
        {!part.contentPreview && content ? <ArtifactContentBody content={content} /> : null}
        {isLoading ? <Skeleton className="h-[120px] w-full" /> : null}
      </div>
    </div>
  );
}

function ArtifactFileRow({
  artifactId,
  extension,
  kind,
  name,
  onOpen,
}: {
  artifactId: string;
  extension: string;
  kind?: string;
  name: string;
  onOpen?: (file_id: string) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <ArtifactIconTile extension={extension} />
      <button
        className="min-w-0 flex-1 text-left"
        type="button"
        onClick={() => onOpen?.(artifactId)}
      >
        <span className="block truncate text-[17px] font-semibold text-foreground">{name}</span>
        <span className="block text-[15px] text-muted-foreground">
          {artifact_kind_label(extension, kind)}
        </span>
      </button>
      <ArtifactActionsMenu artifactId={artifactId} {...(onOpen ? { onOpen } : {})} />
    </div>
  );
}

function ArtifactIconTile({ extension }: { extension: string }) {
  if (extension === 'pdf') {
    return (
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-destructive text-white">
        <span className="text-[13px] font-bold">PDF</span>
      </span>
    );
  }

  return (
    <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-sunken text-muted-foreground">
      <FileText className="size-6" />
    </span>
  );
}

function ArtifactActionsMenu({
  artifactId,
  onOpen,
}: {
  artifactId: string;
  onOpen?: (file_id: string) => void;
}) {
  const adapter = useContext(ChatActionAdapterContext);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Artifact actions"
            className="shrink-0 text-muted-foreground"
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={(event) => event.stopPropagation()}
          >
            <Ellipsis />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onOpen?.(artifactId)}>Open</DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            adapter
              ? void adapter.download_artifact(artifactId)
              : void download_artifact(artifactId)
          }
        >
          Download
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const artifact_kind_labels: Record<string, string> = {
  csv: 'Sheet',
  gif: 'Image',
  html: 'HTML',
  jpeg: 'Image',
  jpg: 'Image',
  json: 'JSON',
  md: 'Markdown',
  pdf: 'PDF',
  png: 'Image',
  txt: 'Text',
  webp: 'Image',
};

function artifact_kind_label(extension: string, kind?: string) {
  const label = artifact_kind_labels[extension];
  if (label) return label;
  if (kind) return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
  return 'File';
}

function file_extension(file_name?: string | null) {
  const dot_index = file_name?.lastIndexOf('.') ?? -1;
  if (!file_name || dot_index <= 0) return '';
  return file_name.slice(dot_index + 1).toLowerCase();
}

async function download_artifact(file_id: string) {
  try {
    await download_file(file_id);
  } catch (error) {
    toast.error(format_error_message(error, 'Could not download the artifact.'));
  }
}

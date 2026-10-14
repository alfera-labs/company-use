import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { DelimitedTable } from '@/components/app/artifact_renderers';
import { FileDownloadLink } from '@/components/app/workspace_file_download_link';
import { is_image_file, workspace_file_extension } from '@/components/app/workspace_file_visuals';
import { CodeBlock, CodeBlockCode, CodeBlockHeader } from '@/components/prompt-kit/code-block';
import { Markdown } from '@/components/prompt-kit/markdown';
import { workspace_file_download_url } from '@/lib/api';

export function WorkspaceFileDocument({
  content_text,
  file_path,
}: {
  content_text: string;
  file_path: string;
}) {
  const extension = workspace_file_extension(file_path);

  if (extension === 'md' || extension === 'markdown') {
    return (
      <article
        className={cn(
          'prose dark:prose-invert relative min-w-full bg-transparent p-0',
          'max-w-3xl prose-h1:mb-5 prose-h1:text-3xl prose-h1:leading-tight prose-h2:mt-8 prose-h2:text-xl prose-p:my-4 prose-p:leading-7 prose-li:my-1.5',
        )}
      >
        <Markdown>{content_text}</Markdown>
      </article>
    );
  }
  if (extension === 'csv' || extension === 'tsv') {
    return <DelimitedTable delimiter={extension === 'tsv' ? '\t' : ','} text={content_text} />;
  }
  if (extension === 'json') {
    const pretty = pretty_json(content_text);
    return (
      <CodeBlock>
        <CodeBlockHeader code={pretty} language="json" />
        <CodeBlockCode code={pretty} language="json" />
      </CodeBlock>
    );
  }
  if (extension === 'html' || extension === 'htm') {
    return (
      <iframe
        className="h-[560px] w-full rounded-2xl border border-border bg-white"
        sandbox="allow-forms allow-popups allow-scripts"
        srcDoc={content_text}
        title={file_path}
      />
    );
  }
  const code_language = code_languages_by_extension[extension];
  if (code_language) {
    return (
      <CodeBlock>
        <CodeBlockHeader code={content_text} language={code_language} />
        <CodeBlockCode code={content_text} language={code_language} />
      </CodeBlock>
    );
  }
  return (
    <pre className="overflow-auto rounded-2xl border border-border bg-sunken p-4 text-sm whitespace-pre-wrap">
      {content_text}
    </pre>
  );
}

export function WorkspaceBinaryFileView({
  byteSize,
  contentKind,
  filePath,
}: {
  byteSize: number;
  contentKind: 'binary' | 'too_large';
  filePath: string;
}) {
  const download_url = workspace_file_download_url(filePath);
  const [zoom, set_zoom] = useState(100);
  const [failed, set_failed] = useState(false);
  const extension = workspace_file_extension(filePath);

  if (contentKind === 'binary' && workspace_file_extension(filePath) === 'pdf') {
    return (
      <iframe className="min-h-0 w-full flex-1 border-0" src={download_url} title={filePath} />
    );
  }
  if (contentKind === 'binary' && is_image_file(filePath) && !failed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-sunken">
        <div className="flex items-center justify-center gap-2 border-b border-border py-1.5">
          <Button
            aria-label="Zoom out"
            size="icon-sm"
            variant="ghost"
            disabled={zoom <= 25}
            onClick={() => set_zoom(zoom - 25)}
          >
            <Minus className="size-4" />
          </Button>
          <button
            type="button"
            className="min-w-12 text-xs"
            title="Reset zoom"
            onClick={() => set_zoom(100)}
          >
            {zoom}%
          </button>
          <Button
            aria-label="Zoom in"
            size="icon-sm"
            variant="ghost"
            disabled={zoom >= 300}
            onClick={() => set_zoom(zoom + 25)}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <img
            alt={filePath}
            className="mx-auto h-auto rounded-lg object-contain"
            style={{ width: `${zoom}%`, maxWidth: 'none' }}
            src={download_url}
            onError={() => set_failed(true)}
          />
        </div>
      </div>
    );
  }
  if (
    contentKind === 'binary' &&
    !failed &&
    ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extension)
  ) {
    return (
      <div className="flex flex-1 items-center p-6">
        <audio
          className="w-full"
          controls
          preload="metadata"
          src={download_url}
          onError={() => set_failed(true)}
          aria-label={filePath}
        >
          <track kind="captions" />
        </audio>
      </div>
    );
  }
  if (contentKind === 'binary' && !failed && ['mp4', 'webm', 'mov'].includes(extension)) {
    return (
      <div className="flex min-h-0 flex-1 items-center bg-sunken">
        <video
          className="max-h-full w-full"
          controls
          preload="metadata"
          src={download_url}
          onError={() => set_failed(true)}
          aria-label={filePath}
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-xs text-sm text-muted-foreground">
        {failed
          ? 'This file could not be previewed. Download it to open it in another app.'
          : contentKind === 'too_large' || byteSize > 25 * 1024 * 1024
            ? 'This file is too large to show here.'
            : 'This file type has no inline preview.'}
      </p>
      <FileDownloadLink file_path={filePath} />
    </div>
  );
}

const code_languages_by_extension: Record<string, string> = {
  css: 'css',
  js: 'javascript',
  log: 'text',
  mjs: 'javascript',
  py: 'python',
  sh: 'bash',
  sql: 'sql',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

function pretty_json(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

import { Badge } from '@coworker/ui/components/badge';
import {
  type ArtifactRendererKey,
  artifact_content_text,
  artifact_renderer_key_to_show,
  code_language_for_artifact,
  delimiter_for_sheet,
  image_source_for_artifact,
  read_artifact,
} from '@/components/app/artifact_renderer_selection';
import { AnswerPicture } from '@/components/prompt-kit/answer_picture';
import { CodeBlock, CodeBlockCode, CodeBlockHeader } from '@/components/prompt-kit/code-block';
import { Markdown } from '@/components/prompt-kit/markdown';
import type { ArtifactContent } from '@/lib/api';

type ArtifactRendererDefinition = {
  renderer_key: ArtifactRendererKey;
  label: string;
  View: (props: { content: ArtifactContent }) => React.ReactNode;
};

const artifact_renderer_definitions: ArtifactRendererDefinition[] = [
  { renderer_key: 'json', label: 'JSON', View: JsonArtifactView },
  { renderer_key: 'sheet', label: 'Sheet', View: SheetArtifactView },
  { renderer_key: 'html', label: 'HTML', View: HtmlArtifactView },
  { renderer_key: 'image', label: 'Image', View: ImageArtifactView },
  { renderer_key: 'code', label: 'Code', View: CodeArtifactView },
  { renderer_key: 'text', label: 'Text', View: TextArtifactView },
  { renderer_key: 'file', label: 'File', View: FileArtifactView },
];

const fallback_artifact_renderer_definition: ArtifactRendererDefinition = {
  renderer_key: 'file',
  label: 'File',
  View: FileArtifactView,
};

export function ArtifactContentRenderer({ content }: { content: ArtifactContent }) {
  const renderer = find_artifact_renderer_definition(content, true);
  const artifact = read_artifact(content);

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">{renderer.label}</Badge>
        {artifact.mime_type ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {artifact.mime_type}
          </span>
        ) : null}
      </div>
      <ArtifactContentBody content={content} opened />
    </div>
  );
}

export function ArtifactContentBody(props: { content: ArtifactContent; opened?: boolean }) {
  const View = find_artifact_renderer_definition(props.content, props.opened ?? false).View;
  return <View content={props.content} />;
}

function find_artifact_renderer_definition(content: ArtifactContent, opened: boolean) {
  const renderer_key = artifact_renderer_key_to_show(content, opened);
  return (
    artifact_renderer_definitions.find((definition) => definition.renderer_key === renderer_key) ??
    fallback_artifact_renderer_definition
  );
}

function TextArtifactView({ content }: { content: ArtifactContent }) {
  const text = artifact_content_text(content);
  if (!text) return <EmptyArtifactBytes />;

  return (
    <article className="prose max-w-none bg-transparent p-0 dark:prose-invert prose-h1:mt-0 prose-h1:mb-5 prose-h1:text-4xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-2xl prose-h2:font-semibold prose-p:my-4 prose-p:leading-7 prose-li:my-1.5 prose-ul:my-4 prose-ol:my-4 prose-strong:font-medium">
      <Markdown>{text}</Markdown>
    </article>
  );
}

function CodeArtifactView({ content }: { content: ArtifactContent }) {
  const code = artifact_content_text(content);
  if (!code) return <EmptyArtifactBytes />;

  const language = code_language_for_artifact(read_artifact(content));
  return (
    <CodeBlock>
      <CodeBlockHeader code={code} language={language} />
      <CodeBlockCode code={code} language={language} />
    </CodeBlock>
  );
}

function JsonArtifactView({ content }: { content: ArtifactContent }) {
  const text = artifact_content_text(content);
  if (!text) return <EmptyArtifactBytes />;

  const parsed = parse_json(text);
  const code = parsed.ok ? JSON.stringify(parsed.value, null, 2) : text;
  return (
    <CodeBlock>
      <CodeBlockHeader code={code} language={parsed.ok ? 'json' : 'text'} />
      <CodeBlockCode code={code} language={parsed.ok ? 'json' : 'text'} />
    </CodeBlock>
  );
}

function HtmlArtifactView({ content }: { content: ArtifactContent }) {
  const html = artifact_content_text(content);
  const artifact = read_artifact(content);
  if (!html) return <EmptyArtifactBytes />;

  return (
    <iframe
      className="h-[560px] w-full rounded-2xl border border-border bg-white"
      sandbox="allow-forms allow-popups allow-scripts"
      srcDoc={html}
      title={artifact.file_name ?? artifact.workspace_path ?? 'HTML artifact'}
    />
  );
}

function ImageArtifactView({ content }: { content: ArtifactContent }) {
  const image_src = image_source_for_artifact(content);
  const artifact = read_artifact(content);
  const name = artifact.file_name ?? artifact.workspace_path ?? 'Artifact image';
  if (!image_src) return <FileArtifactView content={content} />;

  return (
    <div className="overflow-auto rounded-2xl border border-border bg-sunken p-2">
      <AnswerPicture alt={name} src={image_src} />
    </div>
  );
}

function SheetArtifactView({ content }: { content: ArtifactContent }) {
  const text = artifact_content_text(content);
  if (!text) return <EmptyArtifactBytes />;
  return <DelimitedTable delimiter={delimiter_for_sheet(content)} text={text} />;
}

export function DelimitedTable({ delimiter, text }: { delimiter: string; text: string }) {
  const rows = parse_delimited_rows(text, delimiter);
  if (rows.length === 0) return <EmptyArtifactBytes />;

  return (
    <div className="overflow-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <tbody>
          {rows.slice(0, 80).map((row) => (
            <tr className={row === rows[0] ? 'bg-sunken font-medium' : ''} key={row_key(row)}>
              {row.slice(0, 20).map((cell) => (
                <td
                  className="border-r border-b border-border px-2 py-1.5"
                  key={cell_key(row, cell)}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileArtifactView({ content }: { content: ArtifactContent }) {
  const artifact = read_artifact(content);
  return (
    <div className="rounded-2xl border border-border bg-sunken p-3 text-sm">
      <div className="font-medium">
        {artifact.file_name ?? artifact.workspace_path ?? 'Artifact'}
      </div>
      <div className="mt-1 font-mono text-xs text-muted-foreground">
        {artifact.workspace_path ?? artifact.storage_key}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <ArtifactFact label="Kind" value={artifact.file_purpose} />
        <ArtifactFact label="Bytes" value={String(content.byte_size ?? artifact.byte_size ?? 0)} />
      </div>
    </div>
  );
}

function ArtifactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-[11px]">{value}</div>
    </div>
  );
}

function EmptyArtifactBytes() {
  return (
    <div className="rounded-2xl border border-border bg-sunken p-3 text-sm text-muted-foreground">
      No renderable artifact content is available.
    </div>
  );
}

function parse_delimited_rows(text: string, delimiter: string) {
  return text
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => parse_delimited_line(line, delimiter));
}

function parse_delimited_line(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = '';
  let is_quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    const next_character = line[index + 1] ?? '';
    if (character === '"' && next_character === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      is_quoted = !is_quoted;
    } else if (character === delimiter && !is_quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }

  cells.push(cell);
  return cells;
}

function row_key(row: string[]) {
  return row.join('\u001f');
}

function cell_key(row: string[], cell: string) {
  return `${row_key(row)}:${cell}`;
}

function parse_json(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

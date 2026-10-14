import { z } from 'zod';
import {
  type InternalToolDefinition,
  type InternalToolView,
  safe_http_url,
} from '@/components/app/internal_tool_view';

const text_schema = z.object({ text: z.string() }).passthrough();
const file_entry_schema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(['file', 'directory', 'symlink', 'other']),
});
const grep_match_schema = z.object({ path: z.string(), line: z.number(), text: z.string() });
const edit_result_schema = z.object({ replacements: z.number() }).passthrough();
const image_summary_schema = z
  .object({ summary: z.string(), image: z.object({ mime_type: z.string() }) })
  .passthrough();
const pi_result_schema = z
  .object({
    content: z
      .array(
        z.union([
          z.object({ type: z.literal('text'), text: z.string() }),
          z.object({
            type: z.literal('image'),
            data: z.string(),
            mimeType: z.string().optional(),
            mime_type: z.string().optional(),
          }),
        ]),
      )
      .optional(),
    details: z
      .object({ diff: z.string().optional(), patch: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

function input_string(input: unknown, key: string) {
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  const value = parsed.success ? parsed.data[key] : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function output_text(output: unknown) {
  if (typeof output === 'string') return output;
  const text = text_schema.safeParse(output);
  if (text.success) return text.data.text;
  const pi = pi_result_schema.safeParse(output);
  if (!pi.success) return undefined;
  return pi.data.content?.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

function path_summary(input: unknown, verb: string) {
  const path = input_string(input, 'path');
  return path ? `${verb} ${path}` : verb;
}

function read_text_view(input: unknown, output: unknown): InternalToolView | null {
  const text = output_text(output);
  const images = read_raster_images(input, output);
  if (text === undefined && images.length === 0) return null;
  return {
    summary: path_summary(input, 'Read'),
    ...(text === undefined ? {} : { text }),
    ...(images.length ? { images } : {}),
  };
}

function read_file_list_view(input: unknown, output: unknown): InternalToolView | null {
  const parsed = z.array(file_entry_schema).safeParse(output);
  if (!parsed.success) return read_line_items(input, output, 'Listed');
  return {
    summary: path_summary(input, 'Listed'),
    items: parsed.data.map((entry) => ({
      title: entry.path,
      ...(entry.kind === 'file' ? {} : { detail: entry.kind }),
    })),
    ...(parsed.data.length ? {} : { empty_message: 'The folder is empty.' }),
  };
}

function read_line_items(input: unknown, output: unknown, verb: string): InternalToolView | null {
  const paths = z.array(z.string()).safeParse(output);
  const text = paths.success ? paths.data.join('\n') : output_text(output);
  if (text === undefined) return null;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const is_known_empty = [
    '(empty directory)',
    'No files found matching pattern',
    'No matches found',
  ].includes(text.trim());
  return {
    summary: path_summary(input, verb),
    items: is_known_empty ? [] : lines.map((line) => ({ title: line })),
    ...(lines.length && !is_known_empty ? {} : { empty_message: 'No files were found.' }),
  };
}

function read_grep_view(input: unknown, output: unknown): InternalToolView | null {
  const parsed = z.array(grep_match_schema).safeParse(output);
  if (!parsed.success) return read_line_items(input, output, 'Searched');
  return {
    summary: path_summary(input, 'Searched'),
    items: parsed.data.map((match) => ({
      title: `${match.path}:${match.line}`,
      detail: match.text,
    })),
    ...(parsed.data.length ? {} : { empty_message: 'No matches were found.' }),
  };
}

function read_write_view(input: unknown, output: unknown): InternalToolView | null {
  const text = output_text(output);
  if (text === undefined) return null;
  return { summary: path_summary(input, 'Wrote'), text };
}

function read_edit_view(input: unknown, output: unknown): InternalToolView | null {
  const canonical = edit_result_schema.safeParse(output);
  if (canonical.success) {
    return {
      summary: path_summary(input, 'Edited'),
      fields: [{ label: 'Replacements', value: String(canonical.data.replacements) }],
    };
  }
  const pi = pi_result_schema.safeParse(output);
  const diff = pi.success ? (pi.data.details?.diff ?? pi.data.details?.patch) : undefined;
  if (!diff) return read_write_view(input, output);
  return { summary: path_summary(input, 'Edited'), text: diff };
}

const raster_mime_types = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function is_base64_image_data(value: string) {
  return value.length > 0 && value.length % 4 === 0 && /^[a-z\d+/]+={0,2}$/iu.test(value);
}

function read_raster_images(input: unknown, output: unknown) {
  const parsed = pi_result_schema.safeParse(output);
  const title = input_string(input, 'path') ?? 'Image';
  if (!parsed.success) return [];
  return (
    parsed.data.content?.flatMap((part) => {
      if (part.type !== 'image') return [];
      const mime_type = part.mime_type ?? part.mimeType;
      if (!mime_type || !raster_mime_types.has(mime_type)) return [];
      const remote_url = safe_http_url(part.data);
      if (!remote_url && !is_base64_image_data(part.data)) return [];
      return [{ title, image_url: remote_url ?? `data:${mime_type};base64,${part.data}` }];
    }) ?? []
  );
}

function read_image_view(input: unknown, output: unknown): InternalToolView | null {
  const title = input_string(input, 'path') ?? 'Image';
  const images = read_raster_images(input, output);
  const text = output_text(output);
  const canonical = image_summary_schema.safeParse(output);
  if (!images.length && text === undefined && !canonical.success) return null;
  return {
    summary: images.length ? `Viewed ${title}` : `Image result for ${title}`,
    ...(images.length ? { images } : {}),
    ...(text ? { text } : canonical.success ? { text: canonical.data.summary } : {}),
  };
}

function browser_site(input: unknown) {
  const value =
    input_string(input, 'start_url') ??
    input_string(input, 'command')?.match(/https?:\/\/\S+/)?.[0];
  const safe_url = safe_http_url(value);
  return safe_url ? new URL(safe_url).hostname.replace(/^www\./u, '') : undefined;
}

function read_browser_view(input: unknown, output: unknown): InternalToolView | null {
  const site = browser_site(input);
  const image_view = read_image_view({}, output);
  const text = output_text(output);
  if (!image_view?.images?.length && text === undefined) return null;
  return {
    summary: site ? `Browser activity on ${site}` : 'Browser activity',
    ...(site ? { fields: [{ label: 'Site', value: site }] } : {}),
    ...(image_view?.images ? { images: image_view.images } : {}),
    ...(text === undefined ? {} : { text }),
  };
}

function read_preview_view(_input: unknown, output: unknown): InternalToolView | null {
  const parsed = z
    .object({ preview_url: z.string(), port: z.number().optional() })
    .passthrough()
    .safeParse(output);
  if (!parsed.success) return null;
  const url = safe_http_url(parsed.data.preview_url);
  if (!url) return null;
  return {
    summary: 'Preview ready',
    items: [{ title: new URL(url).hostname, url }],
    ...(parsed.data.port === undefined
      ? {}
      : { fields: [{ label: 'Port', value: String(parsed.data.port) }] }),
  };
}

const files = (
  title: string,
  read_view: InternalToolDefinition['read_view'],
): InternalToolDefinition => ({ family: 'files', title, read_view });

export const workspace_internal_tool_definitions: Record<string, InternalToolDefinition> = {
  'workspace-list_files': files('Files', read_file_list_view),
  'workspace-read_file': files('File', read_text_view),
  'workspace-read_document': files('Document', read_text_view),
  'workspace-view_image': { family: 'images', title: 'Image', read_view: read_image_view },
  'workspace-write_file': files('Write file', read_write_view),
  'workspace-edit_file': files('Edit file', read_edit_view),
  'workspace-grep': files('File search', read_grep_view),
  'workspace-glob': files('Files found', (input, output) =>
    read_line_items(input, output, 'Found'),
  ),
  'workspace-preview': { family: 'browser', title: 'Preview', read_view: read_preview_view },
  browser: { family: 'browser', title: 'Browser', read_view: read_browser_view },
  browse: { family: 'browser', title: 'Browser', read_view: read_browser_view },
  read: files('File', read_text_view),
  edit: files('Edit file', read_edit_view),
  write: files('Write file', read_write_view),
  grep: files('File search', read_grep_view),
  find: files('Files found', (input, output) => read_line_items(input, output, 'Found')),
  ls: files('Files', read_file_list_view),
};

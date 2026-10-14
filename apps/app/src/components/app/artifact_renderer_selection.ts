import type { ArtifactContent } from '@/lib/api';

type ArtifactRecord = NonNullable<ArtifactContent['file']>;

export type ArtifactRendererKey = 'text' | 'code' | 'json' | 'html' | 'image' | 'sheet' | 'file';

const artifact_kind_renderer_keys: Record<string, ArtifactRendererKey> = {
  code: 'code',
  custom: 'json',
  download: 'file',
  file: 'file',
  html: 'html',
  image: 'image',
  json: 'json',
  log: 'text',
  screenshot: 'image',
  sheet: 'sheet',
  text: 'text',
  tool_output: 'text',
};

const extension_renderer_keys: Record<string, ArtifactRendererKey> = {
  csv: 'sheet',
  gif: 'image',
  htm: 'html',
  html: 'html',
  jpeg: 'image',
  jpg: 'image',
  json: 'json',
  jsonl: 'json',
  log: 'text',
  md: 'text',
  mjs: 'code',
  png: 'image',
  py: 'code',
  sql: 'code',
  svg: 'image',
  ts: 'code',
  tsx: 'code',
  txt: 'text',
  webp: 'image',
  yaml: 'code',
  yml: 'code',
};

const exact_mime_renderer_keys: Record<string, ArtifactRendererKey> = {
  'application/json': 'json',
  'application/x-ndjson': 'json',
  'text/csv': 'sheet',
  'text/html': 'html',
  'text/markdown': 'text',
  'text/plain': 'text',
  'text/tab-separated-values': 'sheet',
};

const code_language_by_extension: Record<string, string> = {
  mjs: 'javascript',
  py: 'python',
  ts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
};

/**
 * The renderer of an artifact in the place it is shown. A page the coworker wrote runs, and can
 * load from any site, only where the person opened the artifact. A preview that shows by itself
 * shows the page as code.
 */
export function artifact_renderer_key_to_show(
  content: ArtifactContent,
  opened_by_the_person: boolean,
): ArtifactRendererKey {
  const renderer_key = artifact_renderer_key_for_content(content);
  return renderer_key === 'html' && !opened_by_the_person ? 'code' : renderer_key;
}

export function artifact_renderer_key_for_content(content: ArtifactContent): ArtifactRendererKey {
  const artifact = read_artifact(content);
  const kind_key = artifact_kind_renderer_keys[artifact.file_purpose];
  if (kind_key && kind_key !== 'file') return kind_key;

  const mime_key = renderer_key_for_mime_type(artifact.mime_type);
  if (mime_key) return mime_key;

  const text = artifact_content_text(content).trim();
  if (text && parse_json(text).ok) return 'json';

  const extension_key = extension_renderer_keys[artifact_file_extension(artifact)];
  if (extension_key) return extension_key;

  if (kind_key) return kind_key;
  return text ? 'text' : 'file';
}

export function artifact_content_text(content: ArtifactContent) {
  return content.content_text ?? read_artifact(content).content_preview ?? '';
}

function artifact_file_extension(artifact: ArtifactRecord) {
  const path = artifact.file_name ?? artifact.workspace_path ?? artifact.storage_key;
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function code_language_for_artifact(artifact: ArtifactRecord) {
  const extension = artifact_file_extension(artifact);
  return (code_language_by_extension[extension] ?? extension) || 'plaintext';
}

export function image_source_for_artifact(content: ArtifactContent) {
  const text = artifact_content_text(content).trim();
  const mime_type = read_artifact(content).mime_type ?? '';
  if (text.startsWith('data:image/') || text.startsWith('http://') || text.startsWith('https://')) {
    return text;
  }
  if (mime_type.startsWith('image/svg') && text.startsWith('<svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  }
  return undefined;
}

export function delimiter_for_sheet(content: ArtifactContent) {
  const extension = artifact_file_extension(read_artifact(content));
  if (extension === 'tsv') return '\t';
  return artifact_content_text(content).includes('\t') ? '\t' : ',';
}

export function read_artifact(content: ArtifactContent): ArtifactRecord {
  return content.file as ArtifactRecord;
}

function renderer_key_for_mime_type(mime_type: string | null | undefined) {
  if (!mime_type) return undefined;
  const exact_mime_type = mime_type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (exact_mime_renderer_keys[exact_mime_type]) return exact_mime_renderer_keys[exact_mime_type];
  if (exact_mime_type.startsWith('image/')) return 'image';
  if (exact_mime_type.startsWith('text/')) return 'text';
  return undefined;
}

function parse_json(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

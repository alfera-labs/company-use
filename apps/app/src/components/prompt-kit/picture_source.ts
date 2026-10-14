import { is_image_file } from '@/components/app/workspace_file_visuals';
import { workspace_file_path_from_href } from '@/components/prompt-kit/markdown_file_links';
import { workspace_file_download_url } from '@/lib/api';

/** The longest `data:` picture an answer shows: about four megabytes of picture. */
export const longest_inline_picture_address = 6_000_000;

/**
 * Where a picture in text the model wrote comes from, and so whether the browser may load it.
 * A file of the workspace and a picture held in the text itself load at once. A picture of
 * another site loads only after the person asks, because its address can carry private text to
 * that site. Any other address is never loaded.
 */
export type PictureSource =
  | { kind: 'workspace_file'; file_path: string }
  | { kind: 'held_in_the_text'; address: string }
  | { kind: 'other_site'; host: string; address: string }
  | { kind: 'not_loaded' };

export function read_picture_source(address: string | undefined): PictureSource {
  const written = address?.trim() ?? '';
  if (written.startsWith('data:')) return read_picture_held_in_the_text(written);
  const file_path = read_workspace_picture_path(written);
  if (file_path) return { kind: 'workspace_file', file_path };
  const other_site = read_other_site(written);
  return other_site ? { kind: 'other_site', ...other_site } : { kind: 'not_loaded' };
}

function read_picture_held_in_the_text(address: string): PictureSource {
  const is_a_picture = address.startsWith('data:image/');
  const is_short_enough = address.length <= longest_inline_picture_address;
  return is_a_picture && is_short_enough
    ? { kind: 'held_in_the_text', address }
    : { kind: 'not_loaded' };
}

function read_workspace_picture_path(address: string) {
  const download = new URL(workspace_file_download_url(''));
  const written = parse_address(address, download.origin);
  const names_the_download = Boolean(
    written && written.origin === download.origin && written.pathname === download.pathname,
  );
  const file_path = names_the_download
    ? (written?.searchParams.get('file_path') ?? '')
    : workspace_file_path_from_href(address);
  return file_path && is_image_file(file_path) ? file_path : null;
}

function read_other_site(address: string) {
  const own_origin = new URL(workspace_file_download_url('')).origin;
  const written = parse_address(address);
  const is_on_the_web = written?.protocol === 'https:' || written?.protocol === 'http:';
  if (!written || !is_on_the_web || written.origin === own_origin) return null;
  return { host: written.hostname, address: written.href };
}

function parse_address(address: string, base?: string) {
  try {
    return new URL(address, base);
  } catch {
    return null;
  }
}

/**
 * The workspace paths to try for a picture, in order. A path with a folder is tried as written.
 * A bare file name is looked for where the coworker saves files: the files folder first, then
 * the folders the same text names, then the top of the workspace.
 */
export function workspace_picture_paths(file_path: string, folders_in_the_text: readonly string[]) {
  if (file_path.includes('/')) return [file_path];
  const folders = ['files', ...folders_in_the_text.filter((folder) => folder !== 'files')];
  return [...folders.map((folder) => `${folder}/${file_path}`), file_path];
}

const folder_in_text_pattern = /(?<![\w/.-])files(?:\/[\w.-]+)+/gu;
const most_folders_tried = 4;

/** The folders under `files` that a text names, as a path or as the folder of a file path. */
export function workspace_folders_named_in(text: string) {
  const folders = new Set<string>();
  for (const [path] of text.matchAll(folder_in_text_pattern)) {
    const last_part = path.slice(path.lastIndexOf('/') + 1);
    folders.add(last_part.includes('.') ? path.slice(0, path.lastIndexOf('/')) : path);
  }
  return [...folders].slice(0, most_folders_tried);
}

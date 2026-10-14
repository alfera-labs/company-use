import path from 'node:path';
import type { SessionEnv } from '@agent-core/environment';
import { create_logger, format_error_message } from '@coworker/shared';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';

const downloads_directory = 'files';

const log = create_logger('save_downloaded_file');

export type SavedDownload = {
  type: 'file';
  workspace_path: string;
  byte_length: number;
  note: string;
};

export type SaveDownloadedFileInput = {
  environment: SessionEnv | undefined;
  bytes: Uint8Array;
  source_name: string;
};

export async function save_downloaded_file(
  input: SaveDownloadedFileInput,
): Promise<SavedDownload | null> {
  const write_bytes = input.environment?.write_bytes;
  if (!write_bytes || input.bytes.byteLength === 0) return null;

  const file_name = generate_download_file_name(input.source_name, input.bytes);
  const relative_path = `${downloads_directory}/${file_name}`;
  try {
    await write_bytes(relative_path, bytes_to_stream(input.bytes));
  } catch (error) {
    log.warn('could not save a downloaded file into the workspace', {
      relative_path,
      error: format_error_message(error),
    });
    return null;
  }

  const workspace_path = `${current_workspace_layout.model_root}/${relative_path}`;
  return {
    type: 'file',
    workspace_path,
    byte_length: input.bytes.byteLength,
    note: `The downloaded bytes were saved to ${workspace_path}. Open it with a workspace tool — view it if it is an image, read it if it is a document — or run a command over that path. The bytes are not in this result.`,
  };
}

function generate_download_file_name(source_name: string, bytes: Uint8Array): string {
  const base = sanitize_download_file_name(source_name);
  const sniffed_extension = sniff_file_extension(bytes);
  if (path.posix.extname(base)) return base;
  return `${base}${sniffed_extension}`;
}

function sanitize_download_file_name(source_name: string): string {
  const last_segment =
    source_name
      .split(/[/\\?#]/)
      .filter(Boolean)
      .pop() ?? '';
  const cleaned = last_segment.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'download';
}

const file_signatures: ReadonlyArray<{ extension: string; signature: readonly number[] }> = [
  { extension: '.pdf', signature: [0x25, 0x50, 0x44, 0x46] },
  { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47] },
  { extension: '.jpg', signature: [0xff, 0xd8, 0xff] },
  { extension: '.gif', signature: [0x47, 0x49, 0x46, 0x38] },
  // Office files and .zip share the PK header; .zip is the safe name because unzip opens both.
  { extension: '.zip', signature: [0x50, 0x4b, 0x03, 0x04] },
  { extension: '.gz', signature: [0x1f, 0x8b] },
];

function sniff_file_extension(bytes: Uint8Array): string {
  const match = file_signatures.find(({ signature }) =>
    signature.every((byte, index) => bytes[index] === byte),
  );
  return match?.extension ?? '.bin';
}

export function bytes_to_stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

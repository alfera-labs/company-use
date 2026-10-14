import { createHash } from 'node:crypto';
import { AppError } from '@coworker/shared';
import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';

export const inline_text_byte_limit = 1024 * 1024;
export const inline_binary_byte_limit = 4 * 1024 * 1024;

const text_file_extensions = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'html',
  'css',
  'js',
  'mjs',
  'ts',
  'tsx',
  'py',
  'sh',
  'sql',
  'xml',
  'toml',
  'log',
]);

export function content_version_for_bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function file_has_text_format(file_path: string) {
  return text_file_extensions.has(file_extension(file_path));
}

export function decode_workspace_text(file_path: string, bytes: Uint8Array) {
  if (!file_has_text_format(file_path)) {
    throw new AppError(
      'workspace_file_binary_format',
      'This file format cannot be saved as text.',
      422,
    );
  }
  if (bytes.byteLength > inline_text_byte_limit) {
    throw new AppError('workspace_file_too_large', 'Text files can be at most 1 MiB.', 422);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError(
      'workspace_file_invalid_utf8',
      'This text file contains invalid UTF-8 bytes.',
      422,
    );
  }
}

export async function validate_workspace_docx(file_path: string, bytes: Uint8Array) {
  if (file_extension(file_path) !== 'docx') {
    throw new AppError('workspace_file_binary_format', 'Only DOCX files can be saved here.', 422);
  }
  let reader: ZipReader<Uint8Array> | undefined;
  try {
    reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
    const entries = await reader.getEntries();
    const names = new Set(entries.map((entry) => entry.filename));
    if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) throw new Error();
  } catch {
    throw new AppError(
      'workspace_file_invalid_docx',
      'The file is not a valid DOCX document.',
      422,
    );
  } finally {
    await reader?.close();
  }
}

function file_extension(file_path: string) {
  return file_path.split('.').pop()?.toLowerCase() ?? '';
}

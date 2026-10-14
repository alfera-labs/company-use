import { inflateRawSync } from 'node:zlib';

// An .xlsx is a ZIP of XML parts. openpyxl (and some other writers) emit formula
// cells with no cached <v> result, so Excel shows a value only after it
// recalculates on open — but Slack link previews and Quick Look render the file
// as-is and show a blank cell. This walks the ZIP by hand (no archiver
// dependency) to find those uncalculated formula cells before a file ships.

export type UncalculatedFormulaCell = {
  sheet_path: string;
  cell: string;
};

const zip_signature = {
  end_of_central_directory: 0x06054b50,
  central_directory_entry: 0x02014b50,
  local_file_header: 0x04034b50,
} as const;

const max_offending_cells = 50;
const worksheet_path_pattern = /^xl\/worksheets\/sheet[^/]*\.xml$/i;
const formula_cell_pattern = /<f[\s/>]/;
const self_closing_value_pattern = /<v\s*\/>/;
const value_tag_pattern = /<v>([\s\S]*?)<\/v>/;

export function find_uncalculated_formula_cells(file_bytes: Uint8Array): UncalculatedFormulaCell[] {
  try {
    return scan_workbook(to_buffer(file_bytes));
  } catch {
    return [];
  }
}

function to_buffer(file_bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(file_bytes)
    ? file_bytes
    : Buffer.from(file_bytes.buffer, file_bytes.byteOffset, file_bytes.byteLength);
}

function scan_workbook(buf: Buffer): UncalculatedFormulaCell[] {
  const offending: UncalculatedFormulaCell[] = [];
  for (const sheet of read_worksheet_entries(buf)) {
    const xml = read_zip_entry_text(buf, sheet);
    if (xml === null) continue;
    for (const cell of read_uncalculated_cells(xml)) {
      offending.push({ sheet_path: sheet.file_name, cell });
      if (offending.length >= max_offending_cells) return offending;
    }
  }
  return offending;
}

type CentralDirectoryEntry = {
  file_name: string;
  compression_method: number;
  compressed_size: number;
  local_header_offset: number;
};

function read_worksheet_entries(buf: Buffer): CentralDirectoryEntry[] {
  const eocd_offset = find_end_of_central_directory(buf);
  if (eocd_offset === null) return [];

  let offset = buf.readUInt32LE(eocd_offset + 16);
  const entries: CentralDirectoryEntry[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    if (offset + 46 > buf.length) break;
    if (buf.readUInt32LE(offset) !== zip_signature.central_directory_entry) break;

    const compression_method = buf.readUInt16LE(offset + 10);
    const compressed_size = buf.readUInt32LE(offset + 20);
    const file_name_length = buf.readUInt16LE(offset + 28);
    const extra_length = buf.readUInt16LE(offset + 30);
    const comment_length = buf.readUInt16LE(offset + 32);
    const local_header_offset = buf.readUInt32LE(offset + 42);
    const name_start = offset + 46;
    const file_name = buf.toString('utf8', name_start, name_start + file_name_length);

    if (worksheet_path_pattern.test(file_name)) {
      entries.push({ file_name, compression_method, compressed_size, local_header_offset });
    }

    offset = name_start + file_name_length + extra_length + comment_length;
  }
  return entries;
}

function find_end_of_central_directory(buf: Buffer): number | null {
  const record_length = 22;
  const max_comment_length = 65_535;
  if (buf.length < record_length) return null;
  const search_floor = Math.max(0, buf.length - record_length - max_comment_length);
  for (let i = buf.length - record_length; i >= search_floor; i--) {
    if (buf.readUInt32LE(i) === zip_signature.end_of_central_directory) return i;
  }
  return null;
}

function read_zip_entry_text(buf: Buffer, entry: CentralDirectoryEntry): string | null {
  const header_offset = entry.local_header_offset;
  if (header_offset + 30 > buf.length) return null;
  if (buf.readUInt32LE(header_offset) !== zip_signature.local_file_header) return null;

  // The local header repeats name/extra lengths, but they are not guaranteed to
  // match the central directory's — the true data offset must come from here.
  const local_file_name_length = buf.readUInt16LE(header_offset + 26);
  const local_extra_length = buf.readUInt16LE(header_offset + 28);
  const data_start = header_offset + 30 + local_file_name_length + local_extra_length;
  const data_end = data_start + entry.compressed_size;
  if (data_end > buf.length) return null;
  const compressed_data = buf.subarray(data_start, data_end);

  if (entry.compression_method === 0) return compressed_data.toString('utf8');
  if (entry.compression_method === 8) return inflateRawSync(compressed_data).toString('utf8');
  return null;
}

function read_uncalculated_cells(sheet_xml: string): string[] {
  const cell_refs: string[] = [];
  const cell_pattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec-loop idiom
  while ((match = cell_pattern.exec(sheet_xml)) !== null) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    if (!formula_cell_pattern.test(inner)) continue;
    if (cell_has_cached_value(attrs, inner)) continue;
    cell_refs.push(read_cell_reference(attrs));
  }
  return cell_refs;
}

function cell_has_cached_value(attrs: string, inner: string): boolean {
  const is_string_result = /\bt="str"/.test(attrs);
  if (self_closing_value_pattern.test(inner)) return is_string_result;
  const match = inner.match(value_tag_pattern);
  if (!match) return false;
  return is_string_result || (match[1] ?? '').trim().length > 0;
}

function read_cell_reference(attrs: string): string {
  const match = attrs.match(/\br="([^"]*)"/);
  return match?.[1] ?? 'unknown';
}

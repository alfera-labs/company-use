// GFM pipe tables have no Slack equivalent: Slack has no table markup and its message font is
// proportional, so a table only reads as a table inside a code fence where every glyph is the same
// width. This renders one into column-aligned monospace text.

type TableBlock = { rows: string[][]; end_index: number };

export function render_markdown_tables_as_fences(text: string, keep: (value: string) => string) {
  const lines = text.split('\n');
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const table = read_table_block(lines, index);
    if (!table) {
      output.push(lines[index] ?? '');
      continue;
    }
    output.push(keep(render_table_fence(table.rows)));
    index = table.end_index;
  }
  return output.join('\n');
}

function read_table_block(lines: string[], start: number): TableBlock | null {
  const header = lines[start];
  const separator = lines[start + 1];
  if (!header || !separator) return null;
  if (!is_table_row(header) || !is_table_separator(separator)) return null;

  const rows = [read_table_cells(header)];
  let end_index = start + 1;
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !is_table_row(line)) break;
    rows.push(read_table_cells(line));
    end_index = index;
  }
  return { rows, end_index };
}

function is_table_row(line: string) {
  return line.includes('|');
}

function is_table_separator(line: string) {
  const cells = read_table_cells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function read_table_cells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function render_table_fence(rows: string[][]) {
  const widths = read_column_widths(rows);
  const [header = [], ...body] = rows;
  return [
    '```',
    render_table_line(header, widths),
    widths.map((width) => '-'.repeat(width)).join('-+-'),
    ...body.map((row) => render_table_line(row, widths)),
    '```',
  ].join('\n');
}

function read_column_widths(rows: string[][]) {
  const column_count = Math.max(...rows.map((row) => row.length));
  return Array.from({ length: column_count }, (_unused, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
}

// Every column is left-aligned. GFM `:---:` alignment hints are read as separators and
// then ignored; add per-column padding direction if a customer ever notices.
function render_table_line(row: string[], widths: number[]) {
  return widths
    .map((width, column) => (row[column] ?? '').padEnd(width))
    .join(' | ')
    .trimEnd();
}

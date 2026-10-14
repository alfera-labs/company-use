const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { FolderToolError, resolve_inside_folder, path_from_folder } = require('./folder_paths.cjs');

const skipped_folder_names = new Set(['.git', 'node_modules', '.DS_Store']);
const maximum_listed_entries = 500;
const maximum_read_bytes = 5 * 1024 * 1024;
const maximum_returned_characters = 200_000;
const maximum_search_lines = 200;

function list_files(folder, { path: relative_path = '.', depth = 1 }) {
  const lines = [];
  const walk = (directory, levels_left) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (skipped_folder_names.has(entry.name) || lines.length >= maximum_listed_entries) continue;
      const absolute = path.join(directory, entry.name);
      const shown = path_from_folder(folder, absolute);
      if (!entry.isDirectory()) lines.push(`${shown}  (${fs.statSync(absolute).size} bytes)`);
      else {
        lines.push(`${shown}/`);
        if (levels_left > 1) walk(absolute, levels_left - 1);
      }
    }
  };
  walk(resolve_inside_folder(folder, relative_path), Math.min(Math.max(depth, 1), 4));
  if (lines.length === 0) return 'The folder is empty.';
  const cut =
    lines.length >= maximum_listed_entries ? `\n(first ${maximum_listed_entries} shown)` : '';
  return lines.join('\n') + cut;
}

function read_text_file(absolute_path, shown_path) {
  const stat = fs.statSync(absolute_path, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new FolderToolError(`"${shown_path}" is not a file.`);
  if (stat.size > maximum_read_bytes) {
    throw new FolderToolError(
      `"${shown_path}" is ${stat.size} bytes. Files over 5 MB are not read.`,
    );
  }
  const bytes = fs.readFileSync(absolute_path);
  if (bytes.subarray(0, 8000).includes(0)) {
    throw new FolderToolError(
      `"${shown_path}" is not a text file. Use run_command to convert it first.`,
    );
  }
  return bytes.toString('utf8');
}

function read_file(folder, { path: relative_path, start_line = 1, line_count = 2000 }) {
  const text = read_text_file(resolve_inside_folder(folder, relative_path), relative_path);
  const lines = text.split('\n');
  const wanted = lines.slice(start_line - 1, start_line - 1 + line_count).join('\n');
  const more =
    lines.length > start_line - 1 + line_count ? `\n(${lines.length} lines in total)` : '';
  return wanted.slice(0, maximum_returned_characters) + more;
}

function write_file(folder, { path: relative_path, content }) {
  const absolute = resolve_inside_folder(folder, relative_path);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return `Wrote ${Buffer.byteLength(content)} bytes to ${relative_path}.`;
}

function edit_file(folder, { path: relative_path, old_text, new_text, replace_all = false }) {
  const absolute = resolve_inside_folder(folder, relative_path);
  const text = read_text_file(absolute, relative_path);
  const found = text.split(old_text).length - 1;
  if (found === 0) throw new FolderToolError(`The text to replace is not in "${relative_path}".`);
  if (found > 1 && !replace_all) {
    throw new FolderToolError(
      `The text appears ${found} times. Add more of it, or set replace_all.`,
    );
  }
  fs.writeFileSync(
    absolute,
    replace_all ? text.split(old_text).join(new_text) : text.replace(old_text, () => new_text),
  );
  return `Replaced ${replace_all ? found : 1} place${found > 1 && replace_all ? 's' : ''} in ${relative_path}.`;
}

// The grep every Mac ships with. Bundle ripgrep when a large folder makes this slow.
function search_files(folder, { pattern, path: relative_path = '.', case_sensitive = true }) {
  const start = path_from_folder(folder, resolve_inside_folder(folder, relative_path));
  const flags = [
    '-rnIE',
    ...(case_sensitive ? [] : ['-i']),
    '--exclude-dir=.git',
    '--exclude-dir=node_modules',
  ];
  return new Promise((resolve, reject) => {
    const options = { cwd: fs.realpathSync(folder), maxBuffer: 8 * 1024 * 1024, timeout: 30_000 };
    execFile('grep', [...flags, '-e', pattern, '--', start], options, (error, stdout) => {
      const no_match = error?.code === 1;
      if (error && !no_match)
        return reject(new FolderToolError(`The search failed: ${error.message}`));
      const lines = stdout.split('\n').filter(Boolean);
      if (lines.length === 0) return resolve('No match.');
      const cut =
        lines.length > maximum_search_lines
          ? `\n(first ${maximum_search_lines} of ${lines.length} matches)`
          : '';
      resolve(lines.slice(0, maximum_search_lines).join('\n') + cut);
    });
  });
}

module.exports = { list_files, read_file, write_file, edit_file, search_files };

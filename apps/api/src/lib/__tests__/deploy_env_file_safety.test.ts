import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = [
  { file: 'alfera', writer: 'write_setting', reader: 'read_setting' },
  { file: 'install.sh', writer: 'set_env_value', reader: 'read_env_value' },
];

const deploy_folder = join(import.meta.dirname, '../../../../../deploy');

function text_of(file: string) {
  return readFileSync(join(deploy_folder, file), 'utf8');
}

function writer_source(file: string, writer: string) {
  const text = text_of(file);
  const start = text.indexOf(`${writer}() {`);
  return text.slice(start, text.indexOf('\n}\n', start) + 3);
}

function write_with(script: (typeof scripts)[number], key: string, value: string) {
  const folder = mkdtempSync(join(tmpdir(), 'env-writer-'));
  const env_path = join(folder, '.env');
  writeFileSync(env_path, 'FIRST=1\nTHE_KEY=old\nLAST=2\n');
  const program = [
    'set -euo pipefail',
    'umask 022',
    'fail() { printf "%s\\n" "$*" >&2; exit 1; }',
    `install_dir="${folder}"`,
    `env_file="${env_path}"`,
    writer_source(script.file, script.writer),
    writer_source(script.file, script.reader),
    `${script.writer} "$KEY_TO_WRITE" "$VALUE_TO_WRITE"`,
    `${script.reader} "$KEY_TO_WRITE"`,
  ].join('\n');
  let refused = false;
  let read_back = '';
  try {
    read_back = execFileSync('bash', ['-c', program], {
      env: { ...process.env, KEY_TO_WRITE: key, VALUE_TO_WRITE: value },
      stdio: 'pipe',
      encoding: 'utf8',
    }).replace(/\n$/u, '');
  } catch {
    refused = true;
  }
  return {
    refused,
    read_back,
    text: readFileSync(env_path, 'utf8'),
    mode: statSync(env_path).mode & 0o777,
  };
}

function in_double_quotes_as_docker_compose_reads_them(value: string) {
  return `"${value.replace(/[\\"$]/gu, '\\$&')}"`;
}

describe.each(scripts)('the env writer of deploy/$file', (script) => {
  it('reads back a value with backslashes, quotes and dollars exactly as it was typed', () => {
    const typed = String.raw`a\tb\\n&c$1 \x41 "q" 'r' #s`;
    const written = write_with(script, 'THE_KEY', typed);
    expect(written.refused).toBe(false);
    const quoted = in_double_quotes_as_docker_compose_reads_them(typed);
    expect(written.text).toBe(`FIRST=1\nTHE_KEY=${quoted}\nLAST=2\n`);
    expect(written.read_back).toBe(typed);
    expect(written.mode).toBe(0o600);
  });

  it('leaves a plain value bare', () => {
    const written = write_with(script, 'THE_KEY', 'https://alfera.example.com:3000/a_b-c,d@e%2B=');
    expect(written.text).toBe(
      'FIRST=1\nTHE_KEY=https://alfera.example.com:3000/a_b-c,d@e%2B=\nLAST=2\n',
    );
    expect(written.read_back).toBe('https://alfera.example.com:3000/a_b-c,d@e%2B=');
  });

  it('adds a key that is not there yet', () => {
    expect(write_with(script, 'NEW_KEY', 'v').text).toBe(
      'FIRST=1\nTHE_KEY=old\nLAST=2\nNEW_KEY=v\n',
    );
  });

  it('refuses a value that holds a line break, and leaves the file as it was', () => {
    for (const value of ['one\nINJECTED=yes', 'one\rtwo']) {
      const written = write_with(script, 'THE_KEY', value);
      expect(written.refused).toBe(true);
      expect(written.text).toBe('FIRST=1\nTHE_KEY=old\nLAST=2\n');
    }
  });

  it('makes every file it writes readable by its owner only, from its first line of work', () => {
    const lines = text_of(script.file).split('\n');
    const first_commands = lines.filter((line) => line.trim() && !line.startsWith('#')).slice(0, 2);
    expect(first_commands).toEqual(['set -euo pipefail', 'umask 077']);
  });
});

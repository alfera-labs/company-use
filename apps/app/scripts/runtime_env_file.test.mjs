import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import runtime_env_keys_file from '../src/runtime_env_keys.json' with { type: 'json' };
import {
  find_missing_env_keys,
  runtime_env_keys,
  select_runtime_env_lines,
  write_runtime_env_file,
} from './runtime_env_file.mjs';

const repository_root = fileURLToPath(new URL('../../../', import.meta.url));
// Everywhere a key can be read at runtime: the app's own source, the config it builds with, and
// the shared config package it bundles. Scanning only apps/app/src would miss a key a shared
// package starts reading, which is the drift that only shows up in production.
const scanned_source_directories = [
  join(repository_root, 'apps/app/src'),
  join(repository_root, 'apps/app/scripts'),
  join(repository_root, 'packages/config/src'),
];
const scanned_source_files = [join(repository_root, 'apps/app/vite.config.ts')];

const example_env_file = [
  '#/ public key /',
  'DOTENV_PUBLIC_KEY_PRODUCTION="0338"',
  '',
  '# comment',
  'WORKOS_API_KEY="encrypted:AAA"',
  'ARCHIL_API_KEY="encrypted:BBB"',
  'NODE_ENV=production',
].join('\n');

test('keeps the public key header and the wanted keys, drops everything else', () => {
  const selected = select_runtime_env_lines(example_env_file, ['WORKOS_API_KEY', 'NODE_ENV']);

  assert.equal(
    selected,
    [
      '#/ public key /',
      'DOTENV_PUBLIC_KEY_PRODUCTION="0338"',
      '',
      '# comment',
      'WORKOS_API_KEY="encrypted:AAA"',
      'NODE_ENV=production',
    ].join('\n'),
  );
});

test('reports keys the source env file does not define', () => {
  assert.deepEqual(find_missing_env_keys(example_env_file, ['WORKOS_API_KEY', 'SENTRY_DSN']), [
    'SENTRY_DSN',
  ]);
});

// A key in two buckets would either be decrypted twice or, worse, be a build-only secret riding
// into the runtime function. Restating the implementation's concatenation would prove neither.
test('the runtime env keys are unique and never build-time-only keys', () => {
  const keys = runtime_env_keys();
  const build_time = new Set(runtime_env_keys_file.build_time_and_platform_env_keys);

  assert.deepEqual([...new Set(keys)], keys, 'a key is declared twice');
  assert.deepEqual(
    keys.filter((key) => build_time.has(key)),
    [],
    'a build-time-only key would be shipped into the runtime function',
  );
});

// The function vercel-build.sh actually calls. Its failure mode is a deploy, so it gets a test.
test('write_runtime_env_file writes the trimmed file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-env-'));
  const source_path = join(directory, 'source.enc');
  const output_path = join(directory, '.env.runtime.enc');
  writeFileSync(source_path, complete_env_file());

  const written = write_runtime_env_file(source_path, output_path);
  const output = readFileSync(output_path, 'utf8');

  assert.equal(written.output_path, output_path);
  assert.equal(written.key_count, runtime_env_keys().length);
  assert.match(output, /^DOTENV_PUBLIC_KEY_PRODUCTION=/m);
  assert.doesNotMatch(output, /^ARCHIL_API_KEY=/m);
  for (const key of runtime_env_keys_file.required_runtime_env_keys) {
    assert.match(output, new RegExp(`^${key}=`, 'm'), `${key} missing from the runtime env file`);
  }
});

test('write_runtime_env_file refuses a source missing a required key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-env-'));
  const source_path = join(directory, 'source.enc');
  const [dropped, ...kept] = runtime_env_keys_file.required_runtime_env_keys;
  writeFileSync(source_path, complete_env_file(kept));

  assert.throws(() => write_runtime_env_file(source_path, join(directory, 'out.enc')), {
    message: new RegExp(`does not define required runtime env keys: .*${dropped}`),
  });
});

test('write_runtime_env_file refuses a source with a multi-line value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-env-'));
  const source_path = join(directory, 'source.enc');
  writeFileSync(
    source_path,
    `${complete_env_file()}\nPRIVATE_KEY="-----BEGIN KEY-----\nsecret-fragment\n-----END KEY-----"`,
  );

  assert.throws(() => write_runtime_env_file(source_path, join(directory, 'out.enc')), {
    message: /neither a KEY=value, a comment, nor blank/,
  });
});

// The trimmed runtime env file is only correct while the declaration keeps up with the code. A key
// this app reads but never declares would be undefined in production and nowhere else, so the
// mismatch fails here instead.
test('every env key the app source reads is declared', () => {
  const declared = new Set([
    ...runtime_env_keys_file.required_runtime_env_keys,
    ...runtime_env_keys_file.optional_runtime_env_keys,
    ...runtime_env_keys_file.build_time_and_platform_env_keys,
    ...runtime_env_keys_file.forbidden_env_keys,
  ]);

  const undeclared = [...read_env_keys_in_source()].filter((key) => !declared.has(key)).sort();

  assert.deepEqual(
    undeclared,
    [],
    `Add these to apps/app/src/runtime_env_keys.json: ${undeclared.join(', ')}`,
  );
});

function read_env_keys_in_source() {
  const keys = new Set();
  for (const path of [...scanned_source_files, ...list_source_files(scanned_source_directories)]) {
    const text = readFileSync(path, 'utf8');
    for (const [, key] of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) keys.add(key);
  }
  return keys;
}

// Tests are excluded: a key a test sets to exercise a branch is not a key production reads, and a
// key named in a comment is not read at all.
function list_source_files(directories) {
  const paths = [];
  for (const directory of directories) {
    for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
      const name = entry.name;
      if (!entry.isFile() || !/\.(ts|tsx|mjs)$/.test(name)) continue;
      if (/\.test\.(ts|tsx|mjs)$/.test(name)) continue;
      const parent = entry.parentPath ?? entry.path;
      if (parent.includes('__tests__')) continue;
      paths.push(join(parent, name));
    }
  }
  return paths;
}

// A source env file defining every key in `keys`, plus a header and a key the app never reads.
function complete_env_file(keys = runtime_env_keys_file.required_runtime_env_keys) {
  return [
    '#/ public key /',
    'DOTENV_PUBLIC_KEY_PRODUCTION="0338"',
    '',
    'ARCHIL_API_KEY="encrypted:api-only"',
    ...keys.map((key) => `${key}="encrypted:${key}"`),
  ].join('\n');
}

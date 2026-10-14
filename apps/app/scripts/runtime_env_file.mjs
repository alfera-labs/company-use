import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import runtime_env_keys_file from '../src/runtime_env_keys.json' with { type: 'json' };

// The encrypted env files hold the whole monorepo's secrets — around a hundred values covering the
// API, the runtime, and every provider. dotenvx decrypts each one with an asymmetric key, which
// costs well over a second for the full file, and a Vercel function pays that on every cold start
// before it can answer its first request. Sign-in crosses several functions, so it paid that over
// and over.
//
// So the build writes a runtime env file holding only the keys this app reads. Values stay
// encrypted; whole lines are dropped. A required key the source file does not define fails the
// build instead of shipping a function that starts without it.
const public_key_prefix = 'DOTENV_PUBLIC_KEY';

export function runtime_env_keys() {
  return [
    ...runtime_env_keys_file.required_runtime_env_keys,
    ...runtime_env_keys_file.optional_runtime_env_keys,
  ];
}

export function select_runtime_env_lines(source_text, keys) {
  const wanted = new Set(keys);
  return source_text
    .split('\n')
    .filter((line) => {
      const key = read_env_key(line);
      return key === null || key.startsWith(public_key_prefix) || wanted.has(key);
    })
    .join('\n');
}

export { find_lines_that_are_not_one_key };

export function find_missing_env_keys(source_text, keys) {
  const defined = new Set(
    source_text
      .split('\n')
      .map(read_env_key)
      .filter((key) => key !== null),
  );
  return keys.filter((key) => !defined.has(key));
}

// A comment or a blank line carries no key of its own.
function read_env_key(line) {
  return /^([A-Z0-9_]+)=/.exec(line)?.[1] ?? null;
}

// Selection works line by line, so a value spanning several lines would have its `KEY=` line
// dropped while the continuation lines rode into the runtime file as orphaned fragments of a
// secret nobody selected. Every value is a single line today; this fails the build the day one
// is not, instead of shipping a malformed env file.
function find_lines_that_are_not_one_key(source_text) {
  return source_text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#') && read_env_key(line) === null);
}

export function write_runtime_env_file(source_path, output_path) {
  const source_text = readFileSync(source_path, 'utf8');
  const keys = runtime_env_keys();

  const missing = find_missing_env_keys(
    source_text,
    runtime_env_keys_file.required_runtime_env_keys,
  );
  if (missing.length > 0) {
    throw new Error(
      `${source_path} does not define required runtime env keys: ${missing.join(', ')}`,
    );
  }

  const not_one_key = find_lines_that_are_not_one_key(source_text);
  if (not_one_key.length > 0) {
    throw new Error(
      `${source_path} has ${not_one_key.length} line(s) that are neither a KEY=value, a comment, nor blank; a multi-line value cannot be selected safely`,
    );
  }

  writeFileSync(output_path, select_runtime_env_lines(source_text, keys));
  return { key_count: keys.length, output_path };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source_path, output_path] = process.argv.slice(2);
  if (!source_path || !output_path) {
    throw new Error('Usage: node scripts/runtime_env_file.mjs <source_env_file> <output_env_file>');
  }
  const written = write_runtime_env_file(source_path, output_path);
  console.log(`[runtime-env] ${written.output_path} <- ${source_path} (${written.key_count} keys)`);
}

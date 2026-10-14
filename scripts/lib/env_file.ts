import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// A plain KEY=value env file (.env.local and its mode snapshots), edited in place: comments, order
// and every key this code does not name stay as they are. A value is kept as its raw text, quotes
// included, so a restore puts back exactly what was there.

export type EnvValues = Record<string, string>;

const env_line = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function read_env_file(path: string): EnvValues {
  if (!existsSync(path)) return {};
  const values: EnvValues = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = env_line.exec(line);
    if (match?.[1]) values[match[1]] = match[2] ?? '';
  }
  return values;
}

// Sets each key in `set` (in its line, or at the end) and removes each key in `remove`.
export function update_env_file(path: string, change: { set: EnvValues; remove: string[] }) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').replace(/\n$/, '').split('\n') : [];
  const written = new Set<string>();
  const kept = lines.flatMap((line) => {
    const name = env_line.exec(line)?.[1];
    if (!name) return [line];
    if (change.remove.includes(name) && !(name in change.set)) return [];
    if (!(name in change.set)) return [line];
    if (written.has(name)) return [];
    written.add(name);
    return [`${name}=${change.set[name]}`];
  });
  const added = Object.entries(change.set)
    .filter(([name]) => !written.has(name))
    .map(([name, value]) => `${name}=${value}`);
  write_private_file(path, `${[...kept, ...added].join('\n')}\n`);
}

// Owner-only, and never a half-written file: tokens live in these files.
export function write_private_file(path: string, text: string) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export function pick_values(values: EnvValues, names: readonly string[]): EnvValues {
  return Object.fromEntries(names.filter((name) => name in values).map((name) => [name, values[name] ?? '']));
}

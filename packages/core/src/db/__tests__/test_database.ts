import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openAsBlob,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Database } from '@coworker/core/db/connection';
import * as schema from '@coworker/core/db/schema';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { z } from 'zod';

// Tests call this ~1000 times per full run. Booting a fresh PGlite (initdb) and replaying
// every migration costs 3-7s per call; restoring a migrated data directory costs ~150ms.
// The first call on a machine builds the snapshot once, keyed by the migration contents and
// the PGlite version, and every later call restores from it. Each restore is still a brand
// new isolated database, so callers keep the same contract.
const migrations_dir = resolve(import.meta.dirname, '../migrations');
const snapshot_dir = resolve(tmpdir(), 'pglite-test-snapshots');
const package_version_schema = z.object({ version: z.string() });

let snapshot_tar: Promise<Blob> | undefined;

export function open_test_database(client: PGlite): Database {
  return drizzle(client, { schema }) as unknown as Database;
}

export async function create_test_database(): Promise<Database> {
  snapshot_tar ??= read_or_build_snapshot();
  const client = new PGlite({ extensions: { vector }, loadDataDir: await snapshot_tar });
  await client.waitReady;
  return open_test_database(client);
}

async function read_or_build_snapshot(): Promise<Blob> {
  const migrations = readdirSync(migrations_dir)
    .filter((file_name) => file_name.endsWith('.sql'))
    .sort()
    .map((file_name) => readFileSync(resolve(migrations_dir, file_name), 'utf8'));
  const path = resolve(snapshot_dir, `${snapshot_key(migrations)}.tar`);
  if (existsSync(path)) return openAsBlob(path);

  const client = new PGlite({ extensions: { vector } });
  for (const migration_sql of migrations) {
    for (const statement of migration_sql.split('--> statement-breakpoint')) {
      const trimmed_statement = statement.trim();
      if (trimmed_statement) await client.exec(trimmed_statement);
    }
  }
  const tar = await client.dumpDataDir('none');
  await client.close();

  mkdirSync(snapshot_dir, { recursive: true });
  const private_path = `${path}.${process.pid}.tmp`;
  writeFileSync(private_path, new Uint8Array(await tar.arrayBuffer()));
  renameSync(private_path, path);
  return tar;
}

function snapshot_key(migrations: string[]): string {
  const hash = createHash('sha256').update(pglite_version());
  for (const migration_sql of migrations) hash.update(migration_sql);
  return hash.digest('hex').slice(0, 16);
}

function pglite_version(): string {
  const entry_point = createRequire(import.meta.url).resolve('@electric-sql/pglite');
  const package_json = resolve(dirname(dirname(entry_point)), 'package.json');
  return package_version_schema.parse(JSON.parse(readFileSync(package_json, 'utf8'))).version;
}

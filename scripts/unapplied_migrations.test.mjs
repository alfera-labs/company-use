import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  find_applied_hashes_outside_journal,
  find_unapplied_migrations,
  hash_migration,
  read_applied_hashes,
  read_journal_migrations,
  repo_migrations_directory,
} from './unapplied_migrations.mjs';

async function write_migrations_directory(migrations) {
  const directory = mkdtempSync(join(tmpdir(), 'migration-parity-'));
  await mkdir(join(directory, 'meta'));
  for (const [tag, sql] of migrations) {
    writeFileSync(join(directory, `${tag}.sql`), sql);
  }
  writeFileSync(
    join(directory, 'meta/_journal.json'),
    JSON.stringify({ entries: migrations.map(([tag]) => ({ tag })) }),
  );
  return directory;
}

const example_migrations = [
  ['0000_first', 'CREATE TABLE first (id text);\n'],
  ['0001_second', 'CREATE TABLE second (id text);\n'],
  ['0002_third', 'CREATE TABLE third (id text);\n'],
];

test('hashes a migration the way migrate.ts records it', () => {
  // A fixed digest, not a re-derivation: recomputing it with the same call this function makes
  // would pass even if both sides drifted away from what is stored in the database.
  assert.equal(
    hash_migration('CREATE TABLE example (id text);\n'),
    '0f2ff3eb179f68a046851c493a4dfee182ea8d8ffdc092715d830a261a341056',
  );
});

test('reports nothing unapplied when every journal migration ran', async () => {
  const directory = await write_migrations_directory(example_migrations);
  const journal_migrations = read_journal_migrations(directory);

  const unapplied = find_unapplied_migrations(
    journal_migrations,
    journal_migrations.map((migration) => migration.hash),
  );

  assert.deepEqual(unapplied, []);
});

test('catches a missing migration hidden behind extra rows', async () => {
  // The failure this check exists for: the database holds MORE rows than the journal has
  // entries, so the old count check read `applied=5 >= journal=3` and passed, while the newest
  // migration had never run. Nothing here may be softened to make this pass.
  const directory = await write_migrations_directory(example_migrations);
  const journal_migrations = read_journal_migrations(directory);
  const applied_hashes = [
    ...journal_migrations.slice(0, 2).map((migration) => migration.hash),
    hash_migration('CREATE TABLE from_a_renamed_branch_migration (id text);\n'),
    hash_migration('CREATE TABLE from_a_dropped_branch_migration (id text);\n'),
    hash_migration('CREATE TABLE from_a_squashed_branch_migration (id text);\n'),
  ];

  assert.ok(applied_hashes.length > journal_migrations.length);
  assert.deepEqual(
    find_unapplied_migrations(journal_migrations, applied_hashes).map(
      (migration) => migration.tag,
    ),
    ['0002_third'],
  );
});

test('names every unapplied migration, not just the newest', async () => {
  const directory = await write_migrations_directory(example_migrations);
  const journal_migrations = read_journal_migrations(directory);

  const unapplied = find_unapplied_migrations(journal_migrations, [journal_migrations[1].hash]);

  assert.deepEqual(
    unapplied.map((migration) => migration.tag),
    ['0000_first', '0002_third'],
  );
});

test('treats an empty database as missing everything', async () => {
  const directory = await write_migrations_directory(example_migrations);
  const journal_migrations = read_journal_migrations(directory);

  assert.equal(find_unapplied_migrations(journal_migrations, []).length, 3);
});

test('separates applied rows that no migration file explains', async () => {
  const directory = await write_migrations_directory(example_migrations);
  const journal_migrations = read_journal_migrations(directory);
  const orphan_hash = hash_migration('CREATE TABLE from_a_renamed_branch_migration (id text);\n');

  const outside_journal = find_applied_hashes_outside_journal(journal_migrations, [
    ...journal_migrations.map((migration) => migration.hash),
    orphan_hash,
    orphan_hash,
  ]);

  assert.deepEqual(outside_journal, [orphan_hash]);
});

test('reads psql output, ignoring blank lines and padding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-parity-'));
  const hashes_file = join(directory, 'applied.txt');
  writeFileSync(hashes_file, '  aaa \nbbb\n\n');

  assert.deepEqual(read_applied_hashes(hashes_file), ['aaa', 'bbb']);
});

test('every tag in the real journal has a migration file to hash', () => {
  const journal_migrations = read_journal_migrations(repo_migrations_directory);

  assert.ok(journal_migrations.length > 0);
  for (const migration of journal_migrations) {
    assert.match(migration.hash, /^[0-9a-f]{64}$/);
  }
});

// Which migrations in the repo journal have not run against a database?
//
// Comparing two counts, journal entries vs rows in drizzle.__drizzle_migrations, is not the
// same question, and it fails open. A database collects rows for migrations that were applied
// from a feature branch and then renamed, squashed, or dropped before merge, so its row count
// drifts ABOVE the journal length. Once it does, a genuinely missing migration is hidden behind
// a count that still looks big enough: a gate that reads `journal=44 applied=50` passes while
// one migration is missing, and the deploy ships code that reads a column its database lacks.
//
// Identity, not arithmetic: migrate.ts records the sha256 of each migration file's UTF-8 text,
// so the only proof that a specific migration ran is its own hash being present.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repo_migrations_directory = resolve(
  import.meta.dirname,
  '../packages/core/src/db/migrations',
);

// Must stay identical to hash_migration in scripts/migrate.ts. If one side ever hashes
// differently, every migration reads as unapplied and the gate blocks every deploy.
export function hash_migration(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

export function read_journal_migrations(directory) {
  const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8'));
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    hash: hash_migration(readFileSync(join(directory, `${entry.tag}.sql`), 'utf8')),
  }));
}

export function find_unapplied_migrations(journal_migrations, applied_hashes) {
  const applied = new Set(applied_hashes);
  return journal_migrations.filter((migration) => !applied.has(migration.hash));
}

// Rows the database has that no current migration file explains. Not a deploy blocker — the code
// being shipped never needed them — but they are the drift that made counting unsafe, so the
// deploy says them out loud instead of letting them accumulate unseen.
export function find_applied_hashes_outside_journal(journal_migrations, applied_hashes) {
  const in_journal = new Set(journal_migrations.map((migration) => migration.hash));
  return [...new Set(applied_hashes)].filter((hash) => !in_journal.has(hash));
}

export function read_applied_hashes(hashes_file) {
  return readFileSync(hashes_file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function report(hashes_file, migrate_command) {
  const journal_migrations = read_journal_migrations(repo_migrations_directory);
  const applied_hashes = read_applied_hashes(hashes_file);
  const unapplied = find_unapplied_migrations(journal_migrations, applied_hashes);
  const outside_journal = find_applied_hashes_outside_journal(journal_migrations, applied_hashes);

  console.log(
    `migrations: journal=${journal_migrations.length} applied=${applied_hashes.length} unapplied=${unapplied.length}`,
  );

  if (outside_journal.length > 0) {
    console.log(
      `::warning title=Migration rows outside the journal::${outside_journal.length} applied hash(es) match no migration file in the repo. Left over from branch migrations that were renamed or dropped. Harmless to run, but they are why this check compares hashes instead of counts.`,
    );
  }

  if (unapplied.length === 0) return 0;

  const missing_tags = unapplied.map((migration) => migration.tag).join(', ');
  console.log(
    `::error::Database is missing ${unapplied.length} migration(s): ${missing_tags}. Run 'bun run ${migrate_command}' before deploying.`,
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [hashes_file, migrate_command = 'db:migrate'] = process.argv.slice(2);
  if (!hashes_file) {
    console.log('::error::Usage: node scripts/unapplied_migrations.mjs <hashes_file> <command>');
    process.exitCode = 1;
  } else {
    process.exitCode = report(hashes_file, migrate_command);
  }
}

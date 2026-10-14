import { require_database_url } from '@coworker/config';
import { create_database } from '@coworker/core/db/connection';
import {
  backfill_run_event_payloads,
  type RunEventPayloadBackfillOptions,
} from '@runtime-platform/orchestrator/run_event_payload_backfill';

// Moves large values of old run_events payloads to object storage, the way new rows are written.
// You run this; it never runs on deploy. A moved row is never picked again, so a rerun is safe.
// Flags: --write (default is a dry run), --limit N rows (default 1000), --batch-size N (default 20).

function read_options(argv: string[]): RunEventPayloadBackfillOptions {
  if (argv.includes('--write') && argv.includes('--dry-run')) {
    throw new Error('Pass --write or --dry-run, not both.');
  }
  return {
    write: argv.includes('--write'),
    limit: read_positive_integer(argv, '--limit', 1000),
    batch_size: read_positive_integer(argv, '--batch-size', 20),
  };
}

function read_positive_integer(argv: string[], flag: string, fallback: number) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} needs a positive integer.`);
  return value;
}

async function main() {
  const options = read_options(process.argv.slice(2));
  const db = create_database(require_database_url());
  const totals = await backfill_run_event_payloads(db, options);
  const verb = options.write ? 'moved' : 'would move';
  console.log(
    `${options.write ? 'write' : 'dry run'}: looked at ${totals.looked_at} row(s); ` +
      `${verb} ${totals.moved} row(s), ${totals.values} value(s), ` +
      `${(totals.bytes / 1_048_576).toFixed(1)} MiB; ${totals.unchanged} row(s) stay inline; ` +
      `last run_event_id ${totals.last_run_event_id || '-'}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import {
  read_workspace_volume_rollout,
  run_workspace_volume_backfill,
} from '@api/services/provisioning/workspace_volume_backfill';
import { close_database, get_database } from '@coworker/core';

const [command = 'status', ...args] = process.argv.slice(2);

async function main() {
  const db = get_database();
  try {
    if (command === 'status') await print_status(db);
    else if (command === 'verify') await verify_rollout(db);
    else if (command === 'provision') await provision_volumes(db);
    else
      throw new Error(
        'Usage: workspace-volumes <status|provision|verify> [--limit N] [--concurrency N]',
      );
  } finally {
    await close_database();
  }
}

async function print_status(db: ReturnType<typeof get_database>) {
  console.log(JSON.stringify(await read_workspace_volume_rollout(db)));
}

async function verify_rollout(db: ReturnType<typeof get_database>) {
  const status = await read_workspace_volume_rollout(db);
  console.log(JSON.stringify(status));
  if (status.workspaces_needing_volume > 0) {
    throw new Error(`${status.workspaces_needing_volume} active workspaces still need volumes`);
  }
}

async function provision_volumes(db: ReturnType<typeof get_database>) {
  const result = await run_workspace_volume_backfill(db, {
    limit: read_positive_integer('--limit', 10_000),
    concurrency: read_positive_integer('--concurrency', 2),
  });
  console.log(JSON.stringify(result));
  if (result.volumes_failed > 0) {
    throw new Error(`${result.volumes_failed} workspace volumes failed to provision`);
  }
}

function read_positive_integer(flag: string, fallback: number) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
}

main().catch((error) => {
  console.error(error_text(error));
  process.exitCode = 1;
});

function error_text(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const code = 'code' in cause && typeof cause.code === 'string' ? `${cause.code}: ` : '';
  return `${code}${cause.message}`;
}

import { chmod, mkdir, open as open_file, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { close_database, get_database } from '@coworker/core';
import {
  create_slack_fixture_manifest,
  load_slack_fixture_manifest,
  parse_slack_fixture_manifest,
  resolve_slack_fixture_manifest_path,
  type SlackEvalFixtureManifest,
} from '@coworker/evals/slack_fixture_manifest';
import {
  finalize_slack_fixture,
  open_slack_fixture_oauth,
} from '@coworker/evals/slack_fixture_oauth';
import {
  fixture_for_task,
  provision_product_fixtures,
} from '@coworker/evals/slack_fixture_provisioner';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { sleep } from '@coworker/shared';
import { stringify } from 'yaml';

const manifest_lock_timeout_ms = 10_000;
const stale_manifest_lock_ms = 60_000;

type FixtureCommandOptions = {
  manifest_path?: string;
  base_email?: string;
  source_workspace_id?: string;
  task_id?: string;
  team_id?: string;
  channel_id?: string;
};

async function main() {
  const [command, suite_name, ...raw_options] = process.argv.slice(2);
  if (!command || !suite_name) return print_usage_and_fail();
  const options = parse_options(raw_options);
  if (command === 'plan') return plan_fixtures(suite_name, options);
  if (!options.manifest_path) throw new Error('--manifest is required');
  if (command === 'record-slack') return record_slack_fixture(suite_name, options);
  const db = get_database();
  try {
    if (command === 'provision') await provision_fixtures(db, suite_name, options);
    else if (command === 'authorize') await authorize_fixture(db, suite_name, options);
    else if (command === 'finalize') await finalize_fixture(db, suite_name, options);
    else throw new Error(`Unknown fixture command: ${command}`);
  } finally {
    await close_database();
  }
}

async function plan_fixtures(suite_name: string, options: FixtureCommandOptions) {
  if (!options.manifest_path || !options.base_email) {
    throw new Error('plan requires --manifest and --base-email');
  }
  const tasks = await load_eval_tasks(suite_name);
  const manifest = create_slack_fixture_manifest(
    suite_name,
    tasks.map((task) => task.task_id),
    options.base_email,
  );
  await save_new_manifest(options.manifest_path, manifest);
  console.log(`planned ${manifest.fixtures.length} fixtures in ${options.manifest_path}`);
}

async function provision_fixtures(
  db: ReturnType<typeof get_database>,
  suite_name: string,
  options: FixtureCommandOptions,
) {
  if (!options.source_workspace_id) throw new Error('provision requires --source-workspace-id');
  const manifest = await load_matching_manifest(options.manifest_path as string, suite_name);
  const provisioned = await provision_product_fixtures(db, manifest, options.source_workspace_id);
  await update_matching_manifest(options.manifest_path as string, suite_name, (current) =>
    merge_product_fixtures(current, provisioned),
  );
  console.log(`provisioned ${provisioned.fixtures.length} product fixtures`);
}

async function authorize_fixture(
  db: ReturnType<typeof get_database>,
  suite_name: string,
  options: FixtureCommandOptions,
) {
  if (!options.task_id) throw new Error('authorize requires --task');
  const manifest = await load_matching_manifest(options.manifest_path as string, suite_name);
  const fixture = fixture_for_task(manifest, options.task_id);
  await open_slack_fixture_oauth(db, fixture);
  await update_matching_manifest(options.manifest_path as string, suite_name, (current) => ({
    ...current,
    fixtures: current.fixtures.map((item) =>
      item.task_id === fixture.task_id ? { ...item, status: 'oauth_pending' as const } : item,
    ),
  }));
  console.log(`opened Slack OAuth for ${options.task_id}`);
}

async function record_slack_fixture(suite_name: string, options: FixtureCommandOptions) {
  const { task_id, team_id, channel_id } = options;
  if (!task_id || !team_id || !channel_id) {
    throw new Error('record-slack requires --task, --team-id, and --channel-id');
  }
  if (!/^T[A-Z0-9]+$/.test(team_id)) throw new Error('--team-id is invalid');
  if (!/^C[A-Z0-9]+$/.test(channel_id)) throw new Error('--channel-id is invalid');
  await update_matching_manifest(options.manifest_path as string, suite_name, (manifest) => {
    const fixture = fixture_for_task(manifest, task_id);
    return {
      ...manifest,
      fixtures: manifest.fixtures.map((item) =>
        item.task_id === fixture.task_id
          ? {
              ...item,
              status: 'slack_created' as const,
              slack_team_id: team_id,
              slack_channel_id: channel_id,
              slack_workspace_url: `https://app.slack.com/client/${team_id}/${channel_id}`,
            }
          : item,
      ),
    };
  });
  console.log(`recorded ${task_id} team=${team_id} channel=${channel_id}`);
}

async function finalize_fixture(
  db: ReturnType<typeof get_database>,
  suite_name: string,
  options: FixtureCommandOptions,
) {
  if (!options.task_id) throw new Error('finalize requires --task');
  const manifest = await load_matching_manifest(options.manifest_path as string, suite_name);
  const fixture = await finalize_slack_fixture(db, fixture_for_task(manifest, options.task_id));
  await update_matching_manifest(options.manifest_path as string, suite_name, (current) => ({
    ...current,
    fixtures: current.fixtures.map((item) => (item.task_id === fixture.task_id ? fixture : item)),
  }));
  console.log(
    `ready ${fixture.task_id} team=${fixture.slack_team_id} channel=${fixture.slack_channel_id}`,
  );
}

async function load_matching_manifest(pathname: string, suite_name: string) {
  const manifest = await load_slack_fixture_manifest(pathname);
  if (manifest.suite_name !== suite_name) {
    throw new Error(`Manifest belongs to ${manifest.suite_name}, not ${suite_name}`);
  }
  return manifest;
}

function merge_product_fixtures(
  current: SlackEvalFixtureManifest,
  provisioned: SlackEvalFixtureManifest,
) {
  return {
    ...current,
    fixtures: current.fixtures.map((fixture) => {
      const product_fixture = fixture_for_task(provisioned, fixture.task_id);
      return {
        ...fixture,
        ...(product_fixture.product_user_id
          ? { product_user_id: product_fixture.product_user_id }
          : {}),
        ...(product_fixture.product_workspace_id
          ? { product_workspace_id: product_fixture.product_workspace_id }
          : {}),
        status: fixture.status === 'planned' ? product_fixture.status : fixture.status,
      };
    }),
  } satisfies SlackEvalFixtureManifest;
}

async function save_new_manifest(pathname: string, manifest: SlackEvalFixtureManifest) {
  const resolved_path = resolve_slack_fixture_manifest_path(pathname);
  await mkdir(path.dirname(resolved_path), { recursive: true });
  await writeFile(resolved_path, stringify(manifest, { lineWidth: 120 }), {
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(resolved_path, 0o600);
}

async function update_matching_manifest(
  pathname: string,
  suite_name: string,
  update: (manifest: SlackEvalFixtureManifest) => SlackEvalFixtureManifest,
) {
  const resolved_path = resolve_slack_fixture_manifest_path(pathname);
  return with_manifest_lock(resolved_path, async () => {
    const current = await load_matching_manifest(resolved_path, suite_name);
    const updated = parse_slack_fixture_manifest(update(current));
    await replace_manifest(resolved_path, updated);
    return updated;
  });
}

async function replace_manifest(pathname: string, manifest: SlackEvalFixtureManifest) {
  const temporary_path = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary_path, stringify(manifest, { lineWidth: 120 }), { mode: 0o600 });
    await chmod(temporary_path, 0o600);
    await rename(temporary_path, pathname);
  } finally {
    await remove_file_if_present(temporary_path);
  }
}

async function with_manifest_lock<T>(pathname: string, operation: () => Promise<T>) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const lock_path = `${pathname}.lock`;
  const deadline = Date.now() + manifest_lock_timeout_ms;
  const lock_file = await acquire_manifest_lock(lock_path, deadline);
  try {
    await lock_file.writeFile(`${process.pid}\n`);
    return await operation();
  } finally {
    await lock_file.close();
    await remove_file_if_present(lock_path);
  }
}

async function acquire_manifest_lock(lock_path: string, deadline: number) {
  while (true) {
    try {
      return await open_file(lock_path, 'wx', 0o600);
    } catch (error) {
      if (read_error_code(error) !== 'EEXIST') throw error;
      if (await manifest_lock_is_stale(lock_path)) {
        await remove_file_if_present(lock_path);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${lock_path}`);
      await sleep(50);
    }
  }
}

async function manifest_lock_is_stale(lock_path: string) {
  try {
    const lock = await stat(lock_path);
    return Date.now() - lock.mtimeMs > stale_manifest_lock_ms;
  } catch (error) {
    if (read_error_code(error) === 'ENOENT') return false;
    throw error;
  }
}

async function remove_file_if_present(pathname: string) {
  try {
    await unlink(pathname);
  } catch (error) {
    if (read_error_code(error) !== 'ENOENT') throw error;
  }
}

function read_error_code(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function parse_options(raw_options: string[]) {
  const options: FixtureCommandOptions = {};
  for (let index = 0; index < raw_options.length; index += 2) {
    const option = raw_options[index];
    const value = raw_options[index + 1];
    if (!option || !value) throw new Error(`${option ?? 'option'} requires a value`);
    if (option === '--manifest') options.manifest_path = value;
    else if (option === '--base-email') options.base_email = value;
    else if (option === '--source-workspace-id') options.source_workspace_id = value;
    else if (option === '--task') options.task_id = value;
    else if (option === '--team-id') options.team_id = value;
    else if (option === '--channel-id') options.channel_id = value;
    else throw new Error(`Unknown option: ${option}`);
  }
  return options;
}

function print_usage_and_fail() {
  console.error('Usage: bun run fixtures plan <suite> --manifest PATH --base-email EMAIL');
  console.error(
    '       bun run fixtures provision <suite> --manifest PATH --source-workspace-id ID',
  );
  console.error(
    '       bun run fixtures record-slack <suite> --manifest PATH --task TASK_ID --team-id T... --channel-id C...',
  );
  console.error('       bun run fixtures authorize <suite> --manifest PATH --task TASK_ID');
  console.error('       bun run fixtures finalize <suite> --manifest PATH --task TASK_ID');
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}

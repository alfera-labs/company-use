import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  create_slack_fixture_manifest,
  load_slack_fixture_manifest,
} from '@coworker/evals/slack_fixture_manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

const exec_file = promisify(execFile);
const repository_root = path.resolve(import.meta.dirname, '../../..');
const cli_path = path.resolve(import.meta.dirname, 'slack_fixture_cli.ts');
const temporary_directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary_directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Slack fixture CLI', () => {
  it('preserves both fixture updates when two commands run concurrently', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'slack-fixture-cli-'));
    temporary_directories.push(directory);
    const manifest_path = path.join(directory, 'fixtures.yaml');
    const manifest = create_slack_fixture_manifest(
      'slack_operator',
      ['connection_001', 'connection_002'],
      'fixtures@example.com',
    );
    await writeFile(manifest_path, stringify(manifest), { mode: 0o600 });

    await Promise.all([
      record_slack_fixture(manifest_path, 'connection_001', 'T0001', 'C0001'),
      record_slack_fixture(manifest_path, 'connection_002', 'T0002', 'C0002'),
    ]);

    const updated = await load_slack_fixture_manifest(manifest_path);
    expect(updated.fixtures).toMatchObject([
      { task_id: 'connection_001', status: 'slack_created', slack_team_id: 'T0001' },
      { task_id: 'connection_002', status: 'slack_created', slack_team_id: 'T0002' },
    ]);
  });
});

async function record_slack_fixture(
  manifest_path: string,
  task_id: string,
  team_id: string,
  channel_id: string,
) {
  await exec_file(
    'bun',
    [
      '--no-env-file',
      cli_path,
      'record-slack',
      'slack_operator',
      '--manifest',
      manifest_path,
      '--task',
      task_id,
      '--team-id',
      team_id,
      '--channel-id',
      channel_id,
    ],
    { cwd: path.join(repository_root, 'packages/evals') },
  );
}

import { read_cloud_from_the_address } from '@coworker/ui/lib/company_use_deploy/cloud_from_the_address';
import type { ProgressReport } from '@coworker/ui/lib/company_use_deploy/deploy_schemas';
import { add_values_to_the_script } from '@coworker/ui/lib/company_use_deploy/first_boot_user_data';
import {
  build_progress_rows,
  read_outcome,
} from '@coworker/ui/lib/company_use_deploy/progress_rows';
import { assert, describe, test } from 'vitest';

const install_id = '7f1b2c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const started_at = Date.parse('2026-10-13T10:00:00Z');
const line = (
  step: string,
  state: ProgressReport['state'],
  minute: number,
  extra: Partial<ProgressReport> = {},
) => ({
  install_id,
  step,
  state,
  reason: null,
  address: null,
  at: new Date(started_at + minute * 60_000).toISOString(),
  ...extra,
});

describe('the first-boot user data', () => {
  test('keeps the script line first and quotes every value for the shell', () => {
    const script = '#!/bin/bash\nset -eu\necho "$ALFERA_NAME"\n';
    const user_data = add_values_to_the_script(script, [
      ['ALFERA_NAME', "it's"],
      ['ALFERA_REGISTRY_TOKEN', undefined],
    ]);
    const lines = user_data.split('\n');
    assert.strictEqual(lines[0], '#!/bin/bash');
    assert.strictEqual(lines[1], "export ALFERA_NAME='it'\\''s'");
    assert.strictEqual(lines[2], 'set -eu');
    assert.ok(!user_data.includes('ALFERA_REGISTRY_TOKEN'));
  });

  test('refuses a file that is not a script and a result over 16 KB', () => {
    assert.throws(() => add_values_to_the_script('<html>404</html>', []));
    assert.throws(() => add_values_to_the_script(`#!/bin/bash\n${'x'.repeat(17_000)}`, []));
  });
});

describe('the progress of a server', () => {
  test('opens the server only when the last line has a box address', () => {
    const done = line('install', 'done', 9, { address: 'https://acme-203-0-113-7.sslip.io' });
    assert.deepEqual(read_outcome([done], started_at, started_at), {
      kind: 'done',
      address: done.address ?? '',
    });
    const foreign = line('install', 'done', 9, { address: 'https://evil.example.com' });
    assert.strictEqual(read_outcome([foreign], started_at, started_at).kind, 'working');
  });

  test('reports a failed line with its reason and a server that went quiet', () => {
    const failed = line('images', 'failed', 4, { reason: 'image_pull_failed' });
    assert.deepEqual(read_outcome([failed], started_at, started_at), {
      kind: 'failed',
      box_reason: 'image_pull_failed',
    });
    assert.strictEqual(read_outcome([], started_at, started_at + 21 * 60_000).kind, 'silent');
  });

  test('ticks rows in order with the time each one took', () => {
    const reports = [
      line('tools', 'started', 1),
      line('tools', 'done', 2),
      line('source', 'started', 3),
    ];
    const rows = build_progress_rows(reports, started_at, started_at + 5 * 60_000);
    assert.deepEqual(
      rows.map((row) => row.state),
      ['done', 'done', 'live', 'waiting', 'waiting'],
    );
    assert.deepEqual(
      rows.map((row) => row.seconds),
      [60, 120, 120, null, null],
    );
  });
});

describe('the cloud in the page address', () => {
  test('picks DigitalOcean or AWS and ignores any other value', () => {
    assert.strictEqual(read_cloud_from_the_address('?cloud=aws'), 'aws');
    assert.strictEqual(read_cloud_from_the_address('?cloud=digitalocean'), 'digitalocean');
    assert.strictEqual(read_cloud_from_the_address('?cloud=AWS'), null);
    assert.strictEqual(read_cloud_from_the_address('?cloud=gcp'), null);
    assert.strictEqual(read_cloud_from_the_address(''), null);
  });
});

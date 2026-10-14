import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const install_script = readFileSync(
  join(import.meta.dirname, '../../../../../deploy/install.sh'),
  'utf8',
);

function source_of(name: string) {
  const start = install_script.indexOf(`${name}() {`);
  return install_script.slice(start, install_script.indexOf('\n}\n', start) + 3);
}

/** The candidates install.sh would try on a machine whose route table holds these destinations. */
function candidates_left_with_routes(route_destinations: string[]): string[] {
  const program = [
    'set -euo pipefail',
    source_of('subnet_candidates'),
    source_of('overlaps_a_route'),
    source_of('free_subnet_candidates'),
    'host_routes() { printf "%s\\n" "$ROUTES"; }',
    'free_subnet_candidates',
  ].join('\n');
  const output = execFileSync('bash', ['-c', program], {
    env: { ...process.env, ROUTES: route_destinations.join('\n') },
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

describe('the address ranges deploy/install.sh names when Docker has none left', () => {
  it('offers ten ranges of 10.213, and none of 172.16.0.0/12, which cloud networks use', () => {
    const candidates = candidates_left_with_routes(['default', '192.168.1.0/24', '127']);
    expect(candidates).toHaveLength(10);
    expect(candidates[0]).toBe('10.213.210.0/24');
    expect(candidates.at(-1)).toBe('10.213.219.0/24');
  });

  it('skips a range that a route of the machine is inside, in the spelling of ip route', () => {
    const candidates = candidates_left_with_routes(['default', '10.213.210.0/24', '10.213.212.7']);
    expect(candidates).not.toContain('10.213.210.0/24');
    expect(candidates).not.toContain('10.213.212.0/24');
    expect(candidates).toContain('10.213.211.0/24');
    expect(candidates).toHaveLength(8);
  });

  it('skips a range in the spelling of netstat on macOS', () => {
    const candidates = candidates_left_with_routes(['default', '10.213.215/24', '10.213.216.9']);
    expect(candidates).not.toContain('10.213.215.0/24');
    expect(candidates).not.toContain('10.213.216.0/24');
    expect(candidates).toHaveLength(8);
  });

  it('skips every range when a wider route of the machine covers them all', () => {
    expect(candidates_left_with_routes(['10.213.0.0/16'])).toEqual([]);
    expect(candidates_left_with_routes(['10/8'])).toEqual([]);
    expect(candidates_left_with_routes(['10.0.0.0/8'])).toEqual([]);
  });

  it('does not take the default route or an unrelated network for an overlap', () => {
    const routes = ['default', '0.0.0.0/0', '10.10/16', '169.254', '172.31.0.0/16', 'Destination'];
    expect(candidates_left_with_routes(routes)).toHaveLength(10);
  });

  it('removes the override file on each path where the stack did not start', () => {
    const start = source_of('start_with_a_named_subnet');
    const after_a_failed_start = start.slice(start.indexOf('docker compose up -d'));
    expect(after_a_failed_start.indexOf('rm -f')).toBeLessThan(
      after_a_failed_start.indexOf('return 1'),
    );
  });
});

import {
  close_private_addresses_of,
  find_reason_not_to_run_in,
} from '@runtime-platform/orchestrator/docker_sandbox_guard';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const docker = vi.hoisted(() => ({
  calls: [] as string[][],
  answer: (() => '') as (docker_arguments: string[]) => string,
}));

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: (
    _command: string,
    docker_arguments: string[],
    done: (error: Error | null, output?: { stdout: string; stderr: string }) => void,
  ) => {
    docker.calls.push(docker_arguments);
    done(null, { stdout: docker.answer(docker_arguments), stderr: '' });
  },
}));

beforeEach(() => {
  docker.calls = [];
});

describe('a sandbox that is started again while the helper closes its private addresses', () => {
  it('does not count as closed: it is removed, and no command runs in it', async () => {
    let start_time = '2026-10-12T01:00:00.000000001Z';
    docker.answer = (docker_arguments) => {
      if (docker_arguments[0] === 'run') start_time = '2026-10-12T01:00:00.000000900Z';
      return docker_arguments[0] === 'inspect' ? `${start_time}\n` : '';
    };

    await expect(close_private_addresses_of('sandbox-restarted')).rejects.toThrow(
      /started again while its private addresses were closed/u,
    );

    expect(docker.calls.map((call) => call[0])).toEqual(['inspect', 'run', 'inspect', 'rm']);
    expect(await find_reason_not_to_run_in('sandbox-restarted')).toMatch(
      /not cut off from private addresses yet/u,
    );
  });

  it('counts as closed when the start time is the same before and after the helper', async () => {
    docker.answer = (docker_arguments) =>
      docker_arguments[0] === 'inspect' ? '2026-10-12T03:00:00Z\n' : '';

    await close_private_addresses_of('sandbox-steady');

    expect(await find_reason_not_to_run_in('sandbox-steady')).toBeNull();
  });
});

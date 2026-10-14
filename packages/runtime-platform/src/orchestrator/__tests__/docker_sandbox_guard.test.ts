import { env } from '@coworker/config';
import {
  close_private_addresses_arguments,
  close_private_addresses_of,
  closed_sandbox_run_arguments,
  find_reason_not_to_run_in,
  how_to_fix_a_helper_that_failed,
  private_address_ranges,
  route_helper_image,
} from '@runtime-platform/orchestrator/docker_sandbox_guard';
import { wait_for_the_sandbox_image } from '@runtime-platform/orchestrator/docker_sandbox_image';
import { create_sandbox_network_if_missing } from '@runtime-platform/orchestrator/docker_sandbox_network';
import { docker_run_arguments } from '@runtime-platform/orchestrator/docker_workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DockerAnswer = (docker_arguments: string[]) => string;
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
    try {
      done(null, { stdout: docker.answer(docker_arguments), stderr: '' });
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  },
}));

const folders = { host_workspace_root: '/w/ws_1', host_scratch_root: '/w/ws_1/tmp/ses_1' };
const original_env = {
  COWORKER_SANDBOX_PRIVATE_ADDRESSES: env.COWORKER_SANDBOX_PRIVATE_ADDRESSES,
  COWORKER_SANDBOX_DNS: env.COWORKER_SANDBOX_DNS,
};

function value_after(flag: string, docker_arguments: string[]) {
  return docker_arguments[docker_arguments.indexOf(flag) + 1];
}

function a_container_started_at(start_time: { value: string }): DockerAnswer {
  return (docker_arguments) => (docker_arguments[0] === 'inspect' ? `${start_time.value}\n` : '');
}

beforeEach(() => {
  docker.calls = [];
  docker.answer = () => '';
});

afterEach(() => {
  Object.assign(env, original_env);
});

describe('how private addresses are taken from a started sandbox', () => {
  const helper_arguments = close_private_addresses_arguments('coworker-ws-1-ses-1');
  const script = helper_arguments.at(-1) ?? '';

  it('runs a one-shot helper in the network namespace of the sandbox, with the right to change routes', () => {
    expect(helper_arguments.slice(0, 2)).toEqual(['run', '--rm']);
    expect(value_after('--network', helper_arguments)).toBe('container:coworker-ws-1-ses-1');
    expect(value_after('--cap-add', helper_arguments)).toBe('NET_ADMIN');
    expect(helper_arguments.join(' ')).not.toContain('--privileged');
  });

  it('names a pinned helper image, and says how to get it when Docker could not pull it', () => {
    expect(route_helper_image).toMatch(/^busybox:\d+\.\d+/u);
    expect(helper_arguments).toContain(route_helper_image);
    const words = how_to_fix_a_helper_that_failed({ stderr: 'pull access denied\n' });
    expect(words).toContain(`docker pull ${route_helper_image}`);
    expect(words).toContain('Docker said: pull access denied');
    expect(how_to_fix_a_helper_that_failed('no docker')).toContain('Docker said: no docker');
  });

  it('closes every range that is not the public internet, and the own subnet and gateway too', () => {
    const ranges_a_reviewer_named = [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '100.64.0.0/10',
      '169.254.0.0/16',
      '192.0.0.0/24',
      '198.18.0.0/15',
      '168.63.129.16/32',
    ];
    expect(private_address_ranges).toEqual(expect.arrayContaining(ranges_a_reviewer_named));
    for (const range of private_address_ranges) expect(script).toContain(range);
    expect(script).toContain('ip route replace unreachable "$range"');
    expect(script).toContain('ip route del "$own_subnet"');
    expect(script).toContain('ip route replace unreachable "$gateway/32"');
  });

  it('holds the cloud metadata address inside the link-local range it closes', () => {
    expect(private_address_ranges).toContain('169.254.0.0/16');
    const [first, second] = '169.254.169.254'.split('.').map(Number);
    expect([first, second]).toEqual([169, 254]);
  });

  it('keeps the default route, and fails at the first step that fails: no step ends in "or true"', () => {
    expect(script.split('\n')[0]).toBe('set -e');
    expect(script).not.toMatch(/ip route (del|replace unreachable) default/u);
    expect(script).not.toContain('|| true');
  });

  it('refuses a sandbox that has an IPv6 address, because only IPv4 is closed', () => {
    expect(script).toContain("ip -6 addr 2>/dev/null | grep inet6 | grep -qv ' ::1/128'");
    expect(script.indexOf('exit 1')).toBeLessThan(script.indexOf('ip route replace'));
  });
});

describe('how a closed sandbox is started', () => {
  it('has IPv6 off and looks names up at public resolvers, not at one Docker picked', () => {
    const run_arguments = docker_run_arguments('c', folders, 'alfera-sandbox');
    expect(value_after('--sysctl', run_arguments)).toBe('net.ipv6.conf.all.disable_ipv6=1');
    const resolvers = run_arguments.filter(
      (_argument, index) => run_arguments[index - 1] === '--dns',
    );
    expect(resolvers).toEqual(['1.1.1.1', '9.9.9.9']);
    expect(run_arguments).not.toContain('--cap-add');
  });

  it('takes other resolvers from the setting, and leaves the choice to Docker when told to', () => {
    Object.assign(env, { COWORKER_SANDBOX_DNS: '8.8.8.8' });
    expect(closed_sandbox_run_arguments()).toEqual(expect.arrayContaining(['--dns', '8.8.8.8']));
    Object.assign(env, { COWORKER_SANDBOX_DNS: 'docker' });
    expect(closed_sandbox_run_arguments()).not.toContain('--dns');
  });

  it('adds nothing when private addresses are left open', () => {
    Object.assign(env, { COWORKER_SANDBOX_PRIVATE_ADDRESSES: 'open' });
    expect(closed_sandbox_run_arguments()).toEqual([]);
  });
});

describe('a command in a sandbox that stopped and was started again', () => {
  it('runs only when the sandbox was closed after the start it is in now', async () => {
    const start_time = { value: '2026-10-12T01:00:00Z' };
    docker.answer = a_container_started_at(start_time);
    expect(await find_reason_not_to_run_in('sandbox-a')).toMatch(
      /not cut off from private addresses yet/u,
    );

    await close_private_addresses_of('sandbox-a');
    expect(await find_reason_not_to_run_in('sandbox-a')).toBeNull();

    start_time.value = '2026-10-12T02:00:00Z';
    expect(await find_reason_not_to_run_in('sandbox-a')).toMatch(
      /not cut off from private addresses yet/u,
    );

    await close_private_addresses_of('sandbox-a');
    expect(await find_reason_not_to_run_in('sandbox-a')).toBeNull();
    expect(await find_reason_not_to_run_in('sandbox-b')).toMatch(/sandbox-b/u);
  });

  it('removes a sandbox the helper could not close, and does not count it as closed', async () => {
    docker.answer = (docker_arguments) => {
      if (docker_arguments[0] === 'run')
        throw new Error('RTNETLINK answers: Operation not permitted');
      return '2026-10-12T03:00:00Z\n';
    };
    await expect(close_private_addresses_of('sandbox-c')).rejects.toThrow(/so it was removed/u);
    expect(docker.calls).toContainEqual(['rm', '--force', 'sandbox-c']);
    expect(await find_reason_not_to_run_in('sandbox-c')).not.toBeNull();
  });

  it('asks nothing when private addresses are left open', async () => {
    Object.assign(env, { COWORKER_SANDBOX_PRIVATE_ADDRESSES: 'open' });
    expect(await find_reason_not_to_run_in('sandbox-d')).toBeNull();
    await close_private_addresses_of('sandbox-d');
    expect(docker.calls).toEqual([]);
  });
});

describe('making the sandbox network', () => {
  const made_with = () =>
    docker.calls
      .filter((call) => call[0] === 'network' && call[1] === 'create')
      .map((call) =>
        call.includes('--subnet') ? value_after('--subnet', call) : 'a range Docker picks',
      );

  function a_docker_with(free_ranges: string[], pool_is_full: boolean): DockerAnswer {
    let exists = false;
    return (docker_arguments) => {
      if (docker_arguments[1] === 'inspect') {
        if (!exists) throw new Error('No such network');
        return '';
      }
      const subnet = docker_arguments.includes('--subnet')
        ? value_after('--subnet', docker_arguments)
        : null;
      if (subnet === null && pool_is_full) {
        throw new Error('all predefined address pools have been fully subnetted');
      }
      if (subnet !== null && !free_ranges.includes(subnet ?? '')) {
        throw new Error('invalid pool request: Pool overlaps with other one on this address space');
      }
      exists = true;
      return '';
    };
  }

  it('lets Docker pick the range when it has one', async () => {
    docker.answer = a_docker_with([], false);
    await create_sandbox_network_if_missing();
    expect(made_with()).toEqual(['a range Docker picks']);
  });

  it('asks for ranges by name when Docker has none left, and skips the ones that are taken', async () => {
    docker.answer = a_docker_with(['10.213.212.0/24'], true);
    expect(await create_sandbox_network_if_missing()).toBe('alfera-sandbox');
    expect(made_with()).toEqual([
      'a range Docker picks',
      '10.213.210.0/24',
      '10.213.211.0/24',
      '10.213.212.0/24',
    ]);
  });

  it('says how to make it by hand only when every range it tried is taken', async () => {
    docker.answer = a_docker_with([], true);
    await expect(create_sandbox_network_if_missing()).rejects.toThrow(/Make it by hand/u);
    expect(made_with()).toHaveLength(11);
  });

  it('uses a network that is already there as it is', async () => {
    docker.answer = () => '';
    await create_sandbox_network_if_missing();
    expect(made_with()).toEqual([]);
  });
});

describe('the sandbox image of the first chat', () => {
  const a_docker_without_the_image =
    (pull_works: boolean): DockerAnswer =>
    (docker_arguments) => {
      if (docker_arguments[0] === 'image') throw new Error('No such image');
      if (!pull_works) throw new Error('network is unreachable');
      return '';
    };

  it('pulls nothing when the image is already here', async () => {
    await wait_for_the_sandbox_image();
    expect(docker.calls.map((call) => call[0])).toEqual(['image']);
  });

  it('waits for the pull when the image is not here yet', async () => {
    docker.answer = a_docker_without_the_image(true);
    await wait_for_the_sandbox_image();
    expect(docker.calls.at(-1)).toEqual(['pull', '--quiet', 'node:24-bookworm']);
  });

  it('says in plain words that the image did not download', async () => {
    docker.answer = a_docker_without_the_image(false);
    await expect(wait_for_the_sandbox_image()).rejects.toThrow(
      /sandbox image node:24-bookworm is not on this server and did not download/u,
    );
  });
});

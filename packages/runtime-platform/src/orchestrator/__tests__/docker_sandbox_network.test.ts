import {
  sandbox_network_create_arguments,
  sandbox_network_name,
  sandbox_subnet_candidates,
} from '@runtime-platform/orchestrator/docker_sandbox_network';
import { docker_run_arguments } from '@runtime-platform/orchestrator/docker_workspace';
import { describe, expect, it } from 'vitest';

const folders = {
  host_workspace_root: '/var/lib/coworker/workspaces/ws_1',
  host_scratch_root: '/var/lib/coworker/workspaces/ws_1/.scratch/ses_1',
};

function value_after(flag: string, run_arguments: string[]) {
  return run_arguments[run_arguments.indexOf(flag) + 1];
}

describe('how a sandbox container starts', () => {
  const run_arguments = docker_run_arguments('coworker-ws-1-ses-1', folders, 'alfera-sandbox');

  it('is on the sandbox network, named once, before the image', () => {
    expect(run_arguments.filter((argument) => argument === '--network')).toHaveLength(1);
    expect(value_after('--network', run_arguments)).toBe('alfera-sandbox');
    expect(run_arguments.indexOf('--network')).toBeLessThan(
      run_arguments.indexOf('node:24-bookworm'),
    );
  });

  it('gets no way around that network and no extra reach into the host', () => {
    const flags_that_widen_its_reach = [
      '--net',
      '--link',
      '--add-host',
      '--privileged',
      '--pid',
      '--cap-add',
      '--publish',
      '-p',
    ];
    expect(
      run_arguments.filter((argument) => flags_that_widen_its_reach.includes(argument)),
    ).toEqual([]);
    expect(run_arguments.join(' ')).not.toContain('docker.sock');
    expect(value_after('--network', run_arguments)).not.toBe('host');
    expect(value_after('--security-opt', run_arguments)).toBe('no-new-privileges');
    expect(value_after('--user', run_arguments)).toBe('node');
  });

  it('mounts the workspace folder and the session scratch folder, and nothing else', () => {
    const mount_sources = run_arguments
      .filter((argument) => argument.startsWith('type=bind,source='))
      .map((argument) => argument.split(',')[1]?.replace('source=', ''));
    expect(new Set(mount_sources)).toEqual(
      new Set([folders.host_workspace_root, folders.host_scratch_root]),
    );
  });

  it('uses the network the install names, and the default name when it names none', () => {
    expect(sandbox_network_name()).toBe('alfera-sandbox');
    expect(docker_run_arguments('c', folders, 'my-own-network')).toContain('my-own-network');
  });
});

describe('how the sandbox network is made', () => {
  it('is a bridge of its own on which one sandbox cannot reach another', () => {
    const create_arguments = sandbox_network_create_arguments('alfera-sandbox');
    expect(create_arguments.slice(0, 2)).toEqual(['network', 'create']);
    expect(value_after('--driver', create_arguments)).toBe('bridge');
    expect(value_after('--opt', create_arguments)).toBe(
      'com.docker.network.bridge.enable_icc=false',
    );
    expect(create_arguments.at(-1)).toBe('alfera-sandbox');
  });
});

describe('the sandbox network on a machine where Docker has no address range left', () => {
  it('is asked for by name, from a list of private ranges that the installer shares', () => {
    expect(sandbox_subnet_candidates).toHaveLength(10);
    expect(sandbox_subnet_candidates[0]).toBe('10.213.210.0/24');
    expect(sandbox_subnet_candidates.at(-1)).toBe('10.213.219.0/24');
    expect(new Set(sandbox_subnet_candidates).size).toBe(10);
    expect(sandbox_subnet_candidates.filter((subnet) => subnet.startsWith('172.'))).toEqual([]);
    const with_a_range = sandbox_network_create_arguments('alfera-sandbox', '10.213.210.0/24');
    expect(value_after('--subnet', with_a_range)).toBe('10.213.210.0/24');
    expect(with_a_range.at(-1)).toBe('alfera-sandbox');
    expect(sandbox_network_create_arguments('alfera-sandbox')).not.toContain('--subnet');
  });
});

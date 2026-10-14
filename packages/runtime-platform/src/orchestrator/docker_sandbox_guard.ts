import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '@coworker/config';

const exec_file = promisify(execFile);
export const route_helper_image = 'busybox:1.37';

/**
 * Every IPv4 address that is not on the public internet: this machine and its networks, other
 * containers, link-local (cloud metadata at 169.254.169.254 is inside it), carrier-grade NAT,
 * the protocol and benchmark ranges, one cloud's fixed platform address, multicast and reserved.
 */
export const private_address_ranges = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '168.63.129.16/32',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/3',
];

const close_private_addresses_script = [
  'set -e',
  "if ip -6 addr 2>/dev/null | grep inet6 | grep -qv ' ::1/128'; then",
  "  echo 'the sandbox has an IPv6 address, and only IPv4 is closed here' >&2; exit 1",
  'fi',
  `gateway="$(ip route | awk '/^default/ { print $3; exit }')"`,
  `for range in ${private_address_ranges.join(' ')}; do ip route replace unreachable "$range"; done`,
  `ip route | awk '/scope link/ { print $1 }' | while read -r own_subnet; do ip route del "$own_subnet"; done`,
  '[ -z "$gateway" ] || ip route replace unreachable "$gateway/32"',
].join('\n');

export function closes_private_addresses(): boolean {
  return env.COWORKER_SANDBOX_PRIVATE_ADDRESSES !== 'open';
}

/**
 * What a closed sandbox is started with, beside its network. IPv6 is off for it, so an IPv6
 * or IPv4-mapped address is no way around the IPv4 routes. Its names are looked up at public
 * resolvers: Docker's own choice can be a resolver at a private address, which the guard
 * closes. `COWORKER_SANDBOX_DNS=docker` leaves the choice to Docker.
 */
export function closed_sandbox_run_arguments(): string[] {
  if (!closes_private_addresses()) return [];
  const resolvers =
    env.COWORKER_SANDBOX_DNS === 'docker' ? [] : env.COWORKER_SANDBOX_DNS.split(',');
  return [
    '--sysctl',
    'net.ipv6.conf.all.disable_ipv6=1',
    ...resolvers.flatMap((resolver) => ['--dns', resolver.trim()]),
  ];
}

/**
 * The one-shot helper that takes private addresses away from a sandbox. It joins the sandbox's
 * network namespace with the right to change routes, refuses a sandbox that has an IPv6
 * address, makes every private range unreachable, drops the route to the sandbox's own subnet
 * and to the gateway's own address, and exits. The default route stays, so the internet stays.
 * The sandbox itself runs without that right, so the code the coworker runs cannot put a
 * route back.
 */
export function close_private_addresses_arguments(container_name: string): string[] {
  return [
    'run',
    '--rm',
    '--network',
    `container:${container_name}`,
    '--cap-add',
    'NET_ADMIN',
    '--user',
    'root',
    route_helper_image,
    'sh',
    '-c',
    close_private_addresses_script,
  ];
}

const start_at_which_it_was_closed = new Map<string, string>();

async function read_start_time(container_name: string): Promise<string> {
  const { stdout } = await exec_file('docker', [
    'inspect',
    '--format',
    '{{.State.StartedAt}}',
    container_name,
  ]);
  return stdout.trim();
}

/**
 * Leaves a started sandbox with the public internet and nothing else: not the services of this
 * install, not another sandbox, not this machine through the gateway or `host.docker.internal`,
 * not the network the machine is on. A sandbox that cannot be closed this way is not used.
 * The start time is read before the helper runs and again after it. A sandbox that was
 * started again in between has new routes the helper did not close, so it counts as not
 * closed and is removed.
 */
export async function close_private_addresses_of(container_name: string): Promise<void> {
  if (!closes_private_addresses()) return;
  try {
    const start_before_the_helper = await read_start_time(container_name);
    await exec_file('docker', close_private_addresses_arguments(container_name));
    if ((await read_start_time(container_name)) !== start_before_the_helper) {
      throw new Error('The sandbox was started again while its private addresses were closed.');
    }
    start_at_which_it_was_closed.set(container_name, start_before_the_helper);
  } catch (error) {
    const what_became_of_it = await exec_file('docker', ['rm', '--force', container_name]).then(
      () => 'so it was removed',
      (removal_error) => `and it could not be removed either (${String(removal_error)})`,
    );
    throw new Error(
      `The sandbox ${container_name} could not be cut off from private addresses, ${what_became_of_it}. ${how_to_fix_a_helper_that_failed(error)}`,
      { cause: error },
    );
  }
}

/**
 * Docker pulls the helper image the first time a sandbox starts, so a machine that cannot pull
 * it fails here. Docker's own words say which case it is, and they go into the message.
 */
export function how_to_fix_a_helper_that_failed(error: unknown): string {
  const docker_words =
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String(error.stderr).trim()
      : String(error);
  return [
    `The helper image ${route_helper_image} does this, and Docker pulls it the first time.`,
    `If the pull failed, run "docker pull ${route_helper_image}" on this machine.`,
    'If this Docker cannot change routes for a container, or the coworker must reach your own network, set COWORKER_SANDBOX_PRIVATE_ADDRESSES=open and restart.',
    `Docker said: ${docker_words}`,
  ].join(' ');
}

/**
 * Why a command must not run in this sandbox now, or null. A container that stopped and was
 * started again has all its routes back until the helper has run again, so a command runs only
 * when the sandbox was closed after the start it is in now.
 */
export async function find_reason_not_to_run_in(container_name: string): Promise<string | null> {
  if (!closes_private_addresses()) return null;
  const closed_at_start = start_at_which_it_was_closed.get(container_name);
  if (closed_at_start && closed_at_start === (await read_start_time(container_name))) return null;
  return `The sandbox ${container_name} was started and is not cut off from private addresses yet. Send the message again.`;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '@coworker/config';
import { format_error_message } from '@coworker/shared';

const exec_file = promisify(execFile);

/**
 * The Docker network every sandbox container is on, and nothing else is. No service of the
 * install is on it, so a sandbox cannot find the database, the engine, the API, the app or the
 * worker by name. Reaching them by address is closed by the sandbox guard: some Docker
 * platforms pass traffic from one bridge network to another.
 */
export function sandbox_network_name(): string {
  return env.COWORKER_SANDBOX_NETWORK;
}

/**
 * Address ranges to ask for by name when Docker has none left to hand out. A machine with many
 * Docker networks runs out of its predefined pools, and a range asked for by name does not come
 * from those pools. The installer has the same list. No range of 172.16.0.0/12 is in it:
 * cloud networks use those.
 *
 * The installer makes this network on the host, where it first skips a range that a route of
 * the machine overlaps. The worker runs in a container and cannot see those routes, so when
 * it has to make the network again, only Docker's own check against its networks applies.
 */
export const sandbox_subnet_candidates = Array.from(
  { length: 10 },
  (_unused, index) => `10.213.${210 + index}.0/24`,
);

/** One sandbox must not reach another either, so containers on this bridge cannot talk to each other. */
export function sandbox_network_create_arguments(network_name: string, subnet?: string): string[] {
  return [
    'network',
    'create',
    '--driver',
    'bridge',
    '--opt',
    'com.docker.network.bridge.enable_icc=false',
    ...(subnet ? ['--subnet', subnet] : []),
    network_name,
  ];
}

/**
 * Makes the sandbox network on first use. Docker picks the address range. When it has none
 * left, the ranges in `sandbox_subnet_candidates` are tried one after the other, and a range
 * that overlaps a network already there is skipped. A network that is already there is used
 * as it is.
 */
export async function create_sandbox_network_if_missing(): Promise<string> {
  const network_name = sandbox_network_name();
  if (await sandbox_network_exists(network_name)) return network_name;
  const made =
    (await try_to_create(network_name)) ||
    (await try_candidates_in_order(network_name, sandbox_subnet_candidates));
  if (made || (await sandbox_network_exists(network_name))) return network_name;
  throw new Error(
    `The sandbox network ${network_name} could not be made: Docker has no free address range, and each of ${sandbox_subnet_candidates.length} ranges tried by name is taken. Make it by hand with a range that is free on this machine: docker ${sandbox_network_create_arguments(network_name).join(' ')} --subnet <range>`,
  );
}

async function try_candidates_in_order(network_name: string, subnets: string[]): Promise<boolean> {
  const [subnet, ...later_subnets] = subnets;
  if (!subnet) return false;
  if (await try_to_create(network_name, subnet)) return true;
  return try_candidates_in_order(network_name, later_subnets);
}

async function try_to_create(network_name: string, subnet?: string): Promise<boolean> {
  return exec_file('docker', sandbox_network_create_arguments(network_name, subnet)).then(
    () => true,
    () => false,
  );
}

async function sandbox_network_exists(network_name: string): Promise<boolean> {
  return exec_file('docker', ['network', 'inspect', network_name]).then(
    () => true,
    () => false,
  );
}

/**
 * The address ranges of the sandbox network, as Docker gave them out, or none when the network
 * is not there yet or sandboxes do not run in Docker. Throws when Docker cannot say: a caller
 * that keeps requests away from the sandboxes must then send nothing.
 */
export async function read_sandbox_network_subnets(): Promise<string[]> {
  if (env.COWORKER_WORKSPACE_RUNTIME_PROVIDER !== 'docker') return [];
  const subnets_format = '{{range .IPAM.Config}}{{.Subnet}} {{end}}';
  const inspected = await exec_file('docker', [
    'network',
    'inspect',
    sandbox_network_name(),
    '--format',
    subnets_format,
  ]).catch((error: unknown) => {
    if (says_the_network_is_not_there(error)) return { stdout: '' };
    throw error;
  });
  return inspected.stdout.split(/\s+/u).filter(Boolean);
}

function says_the_network_is_not_there(error: unknown): boolean {
  const docker_words = `${format_error_message(error)} ${(error as { stderr?: unknown }).stderr ?? ''}`;
  return /no such network|not found/iu.test(docker_words);
}

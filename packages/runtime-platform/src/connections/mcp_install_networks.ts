import { networkInterfaces } from 'node:os';
import { resolve_host_addresses } from '@coworker/core/credentials/resolve_host_addresses';
import type { InstallNetworks } from '@coworker/core/integrations/mcp_private_server_address';
import {
  read_sandbox_network_subnets,
  sandbox_subnet_candidates,
} from '@runtime-platform/orchestrator/docker_sandbox_network';

/**
 * Reads where this install itself lives, from inside the container that asks (the API when a
 * server is added, the worker when a tool is called). Its own networks are the ones this
 * container has an interface on, where the database, the job engine, the API, the worker and
 * the web app are, plus the sandbox network and every range that network is given when Docker
 * has none free. Nothing is cached: a sandbox network made a moment ago counts at once. It
 * throws when this container shows no network of its own, so that an unknown place is never
 * taken for an empty one; the caller then sends nothing to a private address.
 * One Docker read per request to a private server; cache it for seconds if tool
 * calls to local servers get slow.
 */
export async function read_install_networks(): Promise<InstallNetworks> {
  const [sandbox_subnets, host_machine_addresses] = await Promise.all([
    read_sandbox_network_subnets(),
    resolve_host_addresses('host.docker.internal').catch(() => []),
  ]);
  return {
    own_service_networks: [
      ...list_networks_this_container_is_on(),
      ...sandbox_subnets,
      ...sandbox_subnet_candidates,
    ],
    host_machine_addresses,
  };
}

function list_networks_this_container_is_on(): string[] {
  const networks = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => !address.internal)
    .map(read_network_of_an_interface_address);
  if (networks.length === 0) {
    throw new Error('This container shows no network interface, so its own networks are unknown.');
  }
  return networks;
}

function read_network_of_an_interface_address(address: {
  address: string;
  netmask: string;
  family: string | number;
  cidr: string | null;
}): string {
  return address.cidr ?? `${address.address}/${count_netmask_bits(address)}`;
}

function count_netmask_bits(address: { netmask: string; family: string | number }): number {
  const is_ipv4 = address.family === 'IPv4' || address.family === 4;
  const parts = address.netmask.split(is_ipv4 ? '.' : ':').filter(Boolean);
  return parts
    .map(
      (part) =>
        Number.parseInt(part, is_ipv4 ? 10 : 16)
          .toString(2)
          .replaceAll('0', '').length,
    )
    .reduce((bits, bits_of_part) => bits + bits_of_part, 0);
}

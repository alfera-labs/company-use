import { BlockList, isIP } from 'node:net';
import { is_address_on_list } from '@coworker/core/credentials/safe_outbound_url';

const private_network_addresses = new BlockList();
private_network_addresses.addSubnet('10.0.0.0', 8, 'ipv4');
private_network_addresses.addSubnet('172.16.0.0', 12, 'ipv4');
private_network_addresses.addSubnet('192.168.0.0', 16, 'ipv4');
private_network_addresses.addSubnet('fc00::', 7, 'ipv6');

const cloud_credential_range_in_private_ipv6 = new BlockList();
cloud_credential_range_in_private_ipv6.addSubnet('fd00:ec2::', 32, 'ipv6');

/**
 * True for an address of a private network: the three private IPv4 ranges and the private IPv6
 * range. This is the only part of the blocked ranges that the operator of a self-hosted install
 * can open, for an MCP server on their own network. Loopback, link-local (the cloud metadata
 * address is there) and the carrier range (another cloud keeps its metadata address there) are
 * not in it, and neither is `fd00:ec2::/32`, the part of the private IPv6 range where one cloud
 * keeps its metadata and credential addresses.
 */
export function is_private_network_address(value: string): boolean {
  return (
    is_address_on_list(private_network_addresses, value) &&
    !is_address_on_list(cloud_credential_range_in_private_ipv6, value)
  );
}

/**
 * True for an address inside one of the networks given as `address/prefix`. An IPv4 address
 * written inside an IPv6 one is judged as the IPv4 address it is. Throws on a network that is
 * not written that way, so a list that cannot be read is never taken for an empty one.
 */
export function is_address_inside_networks(value: string, networks: readonly string[]): boolean {
  const list = new BlockList();
  for (const network of networks) {
    const [base = '', prefix = ''] = network.split('/');
    const family = isIP(base);
    if (!family || !/^\d+$/u.test(prefix)) throw new Error(`${network} is not a network.`);
    list.addSubnet(base, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');
  }
  return is_address_on_list(list, value);
}

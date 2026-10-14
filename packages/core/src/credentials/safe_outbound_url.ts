import { BlockList, isIP } from 'node:net';

const metadata_hostnames = [
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
];
const names_of_this_machine = [
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
];
const suffixes_of_inside_names = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

const blocked_addresses = new BlockList();
blocked_addresses.addSubnet('169.254.0.0', 16, 'ipv4');
blocked_addresses.addSubnet('fe80::', 10, 'ipv6');
blocked_addresses.addAddress('fd00:ec2::254', 'ipv6');
blocked_addresses.addSubnet('127.0.0.0', 8, 'ipv4');
blocked_addresses.addSubnet('10.0.0.0', 8, 'ipv4');
blocked_addresses.addSubnet('172.16.0.0', 12, 'ipv4');
blocked_addresses.addSubnet('192.168.0.0', 16, 'ipv4');
blocked_addresses.addSubnet('::', 96, 'ipv6');
blocked_addresses.addSubnet('fc00::', 7, 'ipv6');
blocked_addresses.addSubnet('ff00::', 8, 'ipv6');
blocked_addresses.addSubnet('2001:db8::', 32, 'ipv6');
blocked_addresses.addSubnet('64:ff9b::', 96, 'ipv6');
blocked_addresses.addSubnet('2002::', 16, 'ipv6');
blocked_addresses.addSubnet('0.0.0.0', 8, 'ipv4');
blocked_addresses.addSubnet('100.64.0.0', 10, 'ipv4');
blocked_addresses.addSubnet('192.0.0.0', 24, 'ipv4');
blocked_addresses.addSubnet('192.0.2.0', 24, 'ipv4');
blocked_addresses.addSubnet('198.18.0.0', 15, 'ipv4');
blocked_addresses.addSubnet('198.51.100.0', 24, 'ipv4');
blocked_addresses.addSubnet('203.0.113.0', 24, 'ipv4');
blocked_addresses.addSubnet('224.0.0.0', 4, 'ipv4');
blocked_addresses.addSubnet('240.0.0.0', 4, 'ipv4');

const addresses_of_this_machine = new BlockList();
addresses_of_this_machine.addSubnet('127.0.0.0', 8, 'ipv4');
addresses_of_this_machine.addAddress('::1', 'ipv6');

export type LookupAddresses = (hostname: string) => Promise<string[]>;

export type OutboundUrlVerdict =
  | { may_fetch: true; host: string }
  | { may_fetch: false; because: string; lookup_failed?: true };

/**
 * A host as every rule reads it: lower case, without the brackets of an IPv6 address, without a
 * zone, and without the one dot a name may end in (`api.` is the name `api`).
 */
export function normalize_hostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/%.*$/, '')
    .replace(/\.$/, '');
}

/**
 * True for an address that is not on the public internet: loopback, private, link-local (the
 * cloud metadata address is there), carrier, documentation, multicast and reserved ranges. An
 * IPv4 address written inside an IPv6 one (`::ffff:127.0.0.1`, also in its hex spelling
 * `::ffff:7f00:1`) is judged as the IPv4 address it is. A text that is no address is not
 * blocked here: `is_blocked_host_name` judges names.
 */
export function is_blocked_address(value: string): boolean {
  return is_address_on_list(blocked_addresses, value);
}

/** True for `localhost` and its other names, and for a loopback address. */
export function is_this_machine(value: string): boolean {
  return (
    names_of_this_machine.includes(normalize_hostname(value)) ||
    is_address_on_list(addresses_of_this_machine, value)
  );
}

/** True for the name a cloud gives its metadata service, and for every name under it. */
export function is_cloud_metadata_host_name(value: string): boolean {
  const host = normalize_hostname(value);
  return metadata_hostnames.some((name) => host === name || host.endsWith(`.${name}`));
}

/**
 * True for an address on the list. An IPv4 address written inside an IPv6 one (`::ffff:127.0.0.1`,
 * also in its hex spelling) is judged as the IPv4 address it is. A text that is no address is
 * on no list.
 */
export function is_address_on_list(list: BlockList, value: string): boolean {
  const address = normalize_hostname(value);
  const family = isIP(address);
  if (!family) return false;
  const ipv4_inside = family === 6 ? read_ipv4_inside_ipv6(address) : null;
  if (ipv4_inside) return list.check(ipv4_inside, 'ipv4');
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function read_ipv4_inside_ipv6(address: string): string | null {
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (dotted) return dotted;
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (!hex) return null;
  const high = Number.parseInt(hex[1] ?? '0', 16);
  const low = Number.parseInt(hex[2] ?? '0', 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * True for a name that points inside a network and never at the public internet: this machine
 * (`localhost`), a cloud metadata name, a name of a local network (`.local`, `.internal`,
 * `.lan`), and every name with no dot. A name with no dot is how one service of an install
 * finds another (`api`, `postgres`, `engine`), so a request the coworker was talked into must
 * not reach it. An address is not judged here: `is_blocked_address` does that.
 */
export function is_blocked_host_name(value: string): boolean {
  const host = normalize_hostname(value);
  if (isIP(host)) return false;
  if (!host.includes('.') || names_of_this_machine.includes(host)) return true;
  if (is_cloud_metadata_host_name(host)) return true;
  return suffixes_of_inside_names.some((suffix) => host.endsWith(suffix));
}

/** True for a host, by name or by address, that a request from our own processes must not go to. */
export function is_blocked_host(value: string): boolean {
  return is_blocked_host_name(value) || is_blocked_address(value);
}

export async function decide_whether_to_fetch(input: {
  url: string;
  allowed_hosts: readonly string[];
  lookup_addresses: LookupAddresses;
}): Promise<OutboundUrlVerdict> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { may_fetch: false, because: 'that is not a web address' };
  }
  if (parsed.protocol !== 'https:') {
    return { may_fetch: false, because: 'only https addresses can be used here' };
  }

  const host = normalize_hostname(parsed.hostname);
  if (is_blocked_host(host)) {
    return { may_fetch: false, because: `${host} is not a public address` };
  }
  if (!input.allowed_hosts.map(normalize_hostname).includes(host)) {
    return {
      may_fetch: false,
      because: `${host} is not one of the websites this connection is allowed to reach`,
    };
  }

  let addresses: string[];
  try {
    addresses = await input.lookup_addresses(host);
  } catch {
    return { may_fetch: false, because: `${host} could not be looked up`, lookup_failed: true };
  }
  if (addresses.length === 0) {
    return {
      may_fetch: false,
      because: `${host} does not resolve to an address`,
      lookup_failed: true,
    };
  }
  if (addresses.some(is_blocked_address)) {
    return { may_fetch: false, because: `${host} resolves to an address inside our network` };
  }

  return { may_fetch: true, host };
}

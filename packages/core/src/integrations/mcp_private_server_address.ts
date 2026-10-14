import { isIP } from 'node:net';
import {
  is_address_inside_networks,
  is_private_network_address,
} from '@coworker/core/credentials/private_network_addresses';
import {
  is_cloud_metadata_host_name,
  is_this_machine,
  type LookupAddresses,
  normalize_hostname,
} from '@coworker/core/credentials/safe_outbound_url';

/**
 * What this install does with an MCP server on a private address, for the one who asks.
 * `not_offered`: the hosted product, always. `switched_off`: a self-hosted install whose
 * operator has not opened them. `dashboard_only`: opened, but the coworker asks, and a web page
 * it read could have told it to. `allowed`: opened, and an owner or admin asks in the dashboard.
 */
export type PrivateMcpServerRule = 'not_offered' | 'switched_off' | 'dashboard_only' | 'allowed';

/**
 * Where this install itself lives, read by the process that is about to send the request.
 * `own_service_networks` are the networks its own containers are on (database, job engine, API,
 * worker, web app) and the networks of the sandboxes, each as `address/prefix`. No MCP server
 * may be there. `host_machine_addresses` is what `host.docker.internal` resolves to in this
 * process: the machine itself, which stays reachable even when its address is in such a network.
 */
export type InstallNetworks = {
  own_service_networks: readonly string[];
  host_machine_addresses: readonly string[];
};

export type ReadInstallNetworks = () => Promise<InstallNetworks>;

export type PrivateMcpServerVerdict =
  | { accepted: true; checked_address: string }
  | { accepted: false; because: string };

const the_name_of_this_machine_inside_a_container = 'host.docker.internal';

const host_machine_address_outside_the_private_ranges = '0.250.250.254';

const refusal_of_https_by_name =
  'Alfera reaches a server on your own network by name over http only. Use http:// on a network you trust, or https:// with the IP address of the server.';
const refusal_of_an_own_service =
  "That address is one of Alfera's own services, so give the address of your own MCP server instead.";
const refusal_when_own_networks_are_unknown =
  'Alfera could not read its own networks, so it sent nothing to that address. Run ./alfera doctor on the machine that runs Alfera.';

const refusal_by_rule: Record<Exclude<PrivateMcpServerRule, 'allowed'>, string> = {
  not_offered:
    'Alfera cannot reach a server on your own machine or network. Use an address on the public internet.',
  switched_off:
    'Servers on your own machine or network are switched off on this install. To allow them, run ./alfera add local-mcp on the machine that runs Alfera.',
  dashboard_only:
    'Only an owner or an admin can add a server on your own machine or network. They add it on the Integrations page, under MCP server.',
};

/**
 * Judges an MCP server address whose host is not on the public internet. Nothing is accepted
 * unless the rule is `allowed`, and then only a private network address, written as an address
 * or as a name that resolves to nothing else. This machine's own names are refused, because
 * inside a container they mean the container. A cloud metadata address is refused always. One
 * Docker runtime for macOS gives the machine the address 0.250.250.254, which is in no private
 * range: it is accepted for the name `host.docker.internal` and for nothing else. So
 * is an address in a network of the install itself, and every address when those networks
 * cannot be read: an owner or admin may reach their own servers, never Alfera's services.
 * The verdict names the address that was checked, and the caller sends the request there, with
 * the name in the `Host` header. A certificate cannot be checked for a name that way, so https
 * is accepted only when the address itself is written. A name that cannot be looked up is
 * refused: nothing was checked, so nothing may be sent.
 */
export async function judge_private_mcp_server_address(input: {
  url: URL;
  rule: PrivateMcpServerRule;
  lookup_addresses: LookupAddresses;
  read_install_networks?: ReadInstallNetworks | undefined;
}): Promise<PrivateMcpServerVerdict> {
  if (input.rule !== 'allowed') return refuse(refusal_by_rule[input.rule]);

  const host = normalize_hostname(input.url.hostname);
  const refusal = find_reason_to_refuse_before_lookup(input.url, host);
  if (refusal) return refuse(refusal);

  const addresses = await input.lookup_addresses(host).catch(() => []);
  const [checked_address] = addresses;
  if (checked_address === undefined) {
    return refuse(
      `Alfera could not find ${host} from inside its container. Use the IP address of the server instead.`,
    );
  }
  if (!addresses.every((address) => is_an_address_a_private_server_may_have(host, address))) {
    return refuse(
      `${host} does not point to a private address on your network, so Alfera did not use it. Use the IP address of the server instead.`,
    );
  }
  const refusal_of_the_install = await find_reason_the_install_refuses(
    addresses,
    input.read_install_networks,
  );
  return refusal_of_the_install
    ? refuse(refusal_of_the_install)
    : { accepted: true, checked_address };
}

function is_an_address_a_private_server_may_have(host: string, address: string): boolean {
  if (is_private_network_address(address)) return true;
  return (
    host === the_name_of_this_machine_inside_a_container &&
    address === host_machine_address_outside_the_private_ranges
  );
}

async function find_reason_the_install_refuses(
  addresses: readonly string[],
  read_install_networks: ReadInstallNetworks | undefined,
): Promise<string | null> {
  try {
    if (!read_install_networks) return refusal_when_own_networks_are_unknown;
    const install = await read_install_networks();
    const reaches_an_own_service = addresses.some(
      (address) =>
        !install.host_machine_addresses.includes(address) &&
        is_address_inside_networks(address, install.own_service_networks),
    );
    return reaches_an_own_service ? refusal_of_an_own_service : null;
  } catch {
    return refusal_when_own_networks_are_unknown;
  }
}

function find_reason_to_refuse_before_lookup(url: URL, host: string): string | null {
  if (is_this_machine(host)) {
    const suggested = new URL(url);
    suggested.hostname = the_name_of_this_machine_inside_a_container;
    suggested.protocol = 'http:';
    return `Inside Alfera, ${host} is Alfera's own container. For a server on this machine, use ${suggested.toString()} instead.`;
  }
  if (is_cloud_metadata_host_name(host) || (isIP(host) && !is_private_network_address(host))) {
    return `Alfera never sends a request to ${host}. Use the address of the server on your network, such as 192.168.1.20.`;
  }
  if (!isIP(host) && !host.includes('.')) {
    return `${host} is a name inside Alfera's own network. Use the IP address of the server, or ${the_name_of_this_machine_inside_a_container} for a server on this machine.`;
  }
  if (!isIP(host) && url.protocol === 'https:') return refusal_of_https_by_name;
  return null;
}

function refuse(because: string): PrivateMcpServerVerdict {
  return { accepted: false, because };
}

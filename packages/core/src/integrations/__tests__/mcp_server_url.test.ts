import { isIP } from 'node:net';
import type {
  InstallNetworks,
  PrivateMcpServerRule,
} from '@coworker/core/integrations/mcp_private_server_address';
import { validate_mcp_server_url } from '@coworker/core/integrations/mcp_server_url';
import { describe, expect, it, vi } from 'vitest';

const addresses_by_name: Record<string, string[]> = {
  'mcp.example.com': ['93.184.216.34'],
  'host.docker.internal': ['192.168.65.254', 'fdc4:f303:9324::254'],
  'notes.lan': ['192.168.1.20'],
  'rebound.example.com': ['10.0.0.5'],
  'half.example.com': ['93.184.216.34', '10.0.0.5'],
  'pretends.lan': ['93.184.216.34'],
  'half.internal': ['192.168.1.20', '169.254.169.254'],
  'metadata.google.internal': ['169.254.169.254'],
  'database.lan': ['172.18.0.2'],
  'sandbox.internal': ['172.19.0.5'],
  'not-the-host.internal': ['0.250.250.254'],
  'cloud.lan': ['fd00:ec2::23'],
};

const an_install_on_its_own_networks: InstallNetworks = {
  own_service_networks: ['172.18.0.3/16', '172.19.0.0/16', '10.213.210.0/24', 'fd4d:6169::/64'],
  host_machine_addresses: ['192.168.65.254', 'fdc4:f303:9324::254'],
};

const look_up = vi.fn(async (host: string) => {
  if (isIP(host)) return [host];
  const addresses = addresses_by_name[host];
  if (!addresses) throw new Error(`ENOTFOUND ${host}`);
  return addresses;
});

const read_install_networks = vi.fn(async () => an_install_on_its_own_networks);

function judge(
  url: string,
  private_servers?: PrivateMcpServerRule,
  install: InstallNetworks = an_install_on_its_own_networks,
) {
  look_up.mockClear();
  read_install_networks.mockClear();
  read_install_networks.mockResolvedValue(install);
  return validate_mcp_server_url({
    url,
    lookup_addresses: look_up,
    read_install_networks,
    ...(private_servers ? { private_servers } : {}),
  });
}

const refusal_of_an_own_service =
  "That address is one of Alfera's own services, so give the address of your own MCP server instead.";
const refusal_when_own_networks_are_unknown =
  'Alfera could not read its own networks, so it sent nothing to that address. Run ./alfera doctor on the machine that runs Alfera.';

const private_and_local_addresses = [
  'http://localhost:8000/mcp',
  'https://localhost:8000/mcp',
  'http://127.0.0.1:8000/mcp',
  'http://[::1]:8000/mcp',
  'http://192.168.1.20:8000/mcp',
  'https://192.168.1.20/mcp',
  'http://10.0.0.5/mcp',
  'http://172.20.0.3:3001/mcp',
  'http://[fd12:3456::1]/mcp',
  'http://host.docker.internal:8000/mcp',
  'http://notes.lan/mcp',
  'http://postgres:5432/',
  'http://169.254.169.254/latest/meta-data/',
  'http://metadata.google.internal/',
];

const rules_that_refuse: Array<[PrivateMcpServerRule | undefined, RegExp]> = [
  [undefined, /^Alfera cannot reach a server on your own machine or network\. Use an address/u],
  ['not_offered', /^Alfera cannot reach a server on your own machine or network\./u],
  [
    'switched_off',
    /are switched off on this install\. To allow them, run \.\/alfera add local-mcp/u,
  ],
  [
    'dashboard_only',
    /^Only an owner or an admin can add a server on your own machine or network\./u,
  ],
];

describe('an MCP server address on a private network or on this machine', () => {
  describe.each(rules_that_refuse)('under the rule %s', (rule, sentence) => {
    it.each(private_and_local_addresses)('refuses %s with no lookup', async (url) => {
      const verdict = await judge(url, rule);

      expect(verdict).toEqual({ accepted: false, because: expect.stringMatching(sentence) });
      expect(look_up).not.toHaveBeenCalled();
    });
  });

  it.each([
    'http://192.168.1.20:8000/mcp',
    'https://192.168.1.20/mcp',
    'http://10.0.0.5/mcp',
    'http://172.20.0.3:3001/mcp',
    'http://[fd12:3456::1]/mcp',
    'http://host.docker.internal:8000/mcp',
    'http://notes.lan/mcp',
  ])('accepts %s, on http too, once the operator allowed them and an admin asks', async (url) => {
    expect(await judge(url, 'allowed')).toMatchObject({ accepted: true, endpoint_url: url });
  });

  it.each([
    ['http://localhost:8000/mcp', 'http://host.docker.internal:8000/mcp'],
    ['https://localhost:8443/mcp', 'http://host.docker.internal:8443/mcp'],
    ['http://127.0.0.1:8000/mcp', 'http://host.docker.internal:8000/mcp'],
    ['http://[::1]:8000/mcp', 'http://host.docker.internal:8000/mcp'],
  ])('refuses %s when allowed, and names %s to use instead', async (url, suggested) => {
    const verdict = await judge(url, 'allowed');

    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.because).toContain("is Alfera's own container");
    expect(verdict.because).toContain(`use ${suggested} instead.`);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.170.2/v2/credentials',
    'http://[fd00:ec2::254]/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://100.100.100.200/latest/meta-data/',
    'http://192.0.0.192/opc/v2/instance/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata/computeMetadata/v1/',
    'http://0.0.0.0:8000/mcp',
    'http://[fe80::1]/mcp',
  ])('refuses the cloud metadata or reserved address %s even when allowed', async (url) => {
    const verdict = await judge(url, 'allowed');

    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.because).toMatch(/^Alfera never sends a request to /u);
    expect(look_up).not.toHaveBeenCalled();
  });

  it('refuses a name of the install itself when allowed, and says what to use', async () => {
    const verdict = await judge('http://postgres:5432/', 'allowed');

    expect(verdict).toEqual({
      accepted: false,
      because:
        "postgres is a name inside Alfera's own network. Use the IP address of the server, or host.docker.internal for a server on this machine.",
    });
  });

  it.each([
    'http://pretends.lan/mcp',
    'http://half.internal/mcp',
  ])('refuses %s when allowed, because it does not resolve to private addresses only', async (url) => {
    const verdict = await judge(url, 'allowed');

    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.because).toContain('does not point to a private address on your network');
  });

  it('says to use the IP address when a private name cannot be found', async () => {
    expect(await judge('http://unknown.lan/mcp', 'allowed')).toEqual({
      accepted: false,
      because:
        'Alfera could not find unknown.lan from inside its container. Use the IP address of the server instead.',
    });
  });
});

describe('findings of the security review, with private servers allowed', () => {
  it.each([
    'http://[fd00:ec2::1]/latest/meta-data/',
    'http://[fd00:ec2:ffff::9]/latest/meta-data/',
  ])('refuses %s: the whole cloud credential range of private IPv6 is closed', async (url) => {
    const verdict = await judge(url, 'allowed');

    expect(verdict).toMatchObject({
      accepted: false,
      because: expect.stringMatching(/^Alfera never sends a request to /u),
    });
    expect(look_up).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves into the cloud credential range of private IPv6', async () => {
    expect(await judge('http://cloud.lan/mcp', 'allowed')).toMatchObject({
      accepted: false,
      because: expect.stringContaining('does not point to a private address on your network'),
    });
  });

  it.each([
    ['http://api.:3001/', 'api'],
    ['http://POSTGRES.:5432/', 'postgres'],
  ])('refuses %s: a name with no dot stays one with a dot at its end', async (url, name) => {
    const verdict = await judge(url, 'allowed');

    expect(verdict).toMatchObject({
      accepted: false,
      because: expect.stringContaining(`${name} is a name inside Alfera's own network.`),
    });
    expect(look_up).not.toHaveBeenCalled();
  });

  it('judges and saves a name with a dot at its end as the name without it', async () => {
    expect(await judge('http://Host.Docker.Internal.:8000/mcp', 'allowed')).toMatchObject({
      accepted: true,
      endpoint_url: 'http://host.docker.internal:8000/mcp',
      host: 'host.docker.internal',
    });
    expect(await judge('https://mcp.example.com./mcp')).toEqual({
      accepted: true,
      endpoint_url: 'https://mcp.example.com/mcp',
      host: 'mcp.example.com',
    });
  });

  it('names the one address it checked, so the request can go to that address and no other', async () => {
    expect(await judge('http://notes.lan/mcp', 'allowed')).toMatchObject({
      accepted: true,
      checked_address: '192.168.1.20',
    });
    expect(await judge('http://host.docker.internal:8000/mcp', 'allowed')).toMatchObject({
      accepted: true,
      checked_address: '192.168.65.254',
    });
    expect(await judge('https://mcp.example.com/mcp', 'allowed')).not.toHaveProperty(
      'checked_address',
    );
  });

  it('refuses https to a private server by name, and says to use http on a trusted network', async () => {
    expect(await judge('https://notes.lan/mcp', 'allowed')).toEqual({
      accepted: false,
      because:
        'Alfera reaches a server on your own network by name over http only. Use http:// on a network you trust, or https:// with the IP address of the server.',
    });
    expect(await judge('https://192.168.1.20/mcp', 'allowed')).toMatchObject({ accepted: true });
  });

  it('does not let a private name that cannot be looked up pass as a lookup that may be tried again', async () => {
    const verdict = await judge('http://unknown.lan/mcp', 'allowed');

    expect(verdict.accepted).toBe(false);
    expect(verdict).not.toHaveProperty('lookup_failed');
  });
});

describe("an MCP server address inside the install's own networks, with private servers allowed", () => {
  it.each([
    ['the database, on the network of the stack', 'http://172.18.0.2:5432/'],
    ['the gateway of that network', 'http://172.18.0.1:3001/mcp'],
    ['a sandbox, on the sandbox network Docker picked', 'http://172.19.0.5:3000/mcp'],
    ['a sandbox, on a range the network takes when Docker has none', 'http://10.213.210.7/mcp'],
    ['a service on the IPv6 range of the stack', 'http://[fd4d:6169::5]/mcp'],
    ['the database, as an IPv4 address inside an IPv6 one', 'http://[::ffff:172.18.0.2]/mcp'],
    ['the database, by a name that resolves to it', 'http://database.lan/mcp'],
    ['a sandbox, by a name that resolves to it', 'http://sandbox.internal/mcp'],
  ])('refuses %s', async (_what, url) => {
    expect(await judge(url, 'allowed')).toEqual({
      accepted: false,
      because: refusal_of_an_own_service,
    });
  });

  it('reads the networks only for a private address it would otherwise accept', async () => {
    await judge('https://mcp.example.com/mcp', 'allowed');
    await judge('http://localhost:8000/mcp', 'allowed');
    await judge('http://169.254.169.254/', 'allowed');
    await judge('http://192.168.1.20:8000/mcp', 'switched_off');
    expect(read_install_networks).not.toHaveBeenCalled();

    await judge('http://192.168.1.20:8000/mcp', 'allowed');
    expect(read_install_networks).toHaveBeenCalledTimes(1);
  });

  it('accepts the machine itself at the address one Docker runtime gives it, and that address for no other name', async () => {
    addresses_by_name['host.docker.internal'] = ['0.250.250.254'];
    const on_that_runtime = {
      ...an_install_on_its_own_networks,
      host_machine_addresses: ['0.250.250.254'],
    };

    expect(
      await judge('http://host.docker.internal:8000/mcp', 'allowed', on_that_runtime),
    ).toMatchObject({
      accepted: true,
    });
    expect(
      await judge('http://not-the-host.internal/mcp', 'allowed', on_that_runtime),
    ).toMatchObject({
      accepted: false,
      because: expect.stringContaining('does not point to a private address on your network'),
    });
    expect(await judge('http://0.250.250.254:8000/mcp', 'allowed', on_that_runtime)).toMatchObject({
      accepted: false,
      because: expect.stringMatching(/^Alfera never sends a request to 0\.250\.250\.254\./u),
    });
    addresses_by_name['host.docker.internal'] = ['192.168.65.254', 'fdc4:f303:9324::254'];
  });

  it('accepts the machine itself when its address is inside an own network, and nothing else in that network', async () => {
    addresses_by_name['host.docker.internal'] = ['172.18.0.1'];
    const host_on_the_stack_network = {
      ...an_install_on_its_own_networks,
      host_machine_addresses: ['172.18.0.1'],
    };

    expect(
      await judge('http://host.docker.internal:8000/mcp', 'allowed', host_on_the_stack_network),
    ).toMatchObject({ accepted: true });
    expect(
      await judge('http://172.18.0.1:8000/mcp', 'allowed', host_on_the_stack_network),
    ).toMatchObject({
      accepted: true,
    });
    expect(await judge('http://172.18.0.2:8000/mcp', 'allowed', host_on_the_stack_network)).toEqual(
      {
        accepted: false,
        because: refusal_of_an_own_service,
      },
    );
    addresses_by_name['host.docker.internal'] = ['192.168.65.254', 'fdc4:f303:9324::254'];
  });

  it.each([
    ['cannot be read', () => Promise.reject(new Error('Cannot connect to the Docker daemon'))],
    [
      'hold a range that is not written as a network',
      () =>
        Promise.resolve({ own_service_networks: ['alfera-sandbox'], host_machine_addresses: [] }),
    ],
  ])('refuses every private address when the networks %s', async (_why, read_networks) => {
    const verdict = await validate_mcp_server_url({
      url: 'http://192.168.1.20:8000/mcp',
      lookup_addresses: look_up,
      private_servers: 'allowed',
      read_install_networks: read_networks,
    });

    expect(verdict).toEqual({ accepted: false, because: refusal_when_own_networks_are_unknown });
  });

  it('refuses every private address for a caller that gives no way to read the networks', async () => {
    const verdict = await validate_mcp_server_url({
      url: 'http://192.168.1.20:8000/mcp',
      lookup_addresses: look_up,
      private_servers: 'allowed',
    });

    expect(verdict).toEqual({ accepted: false, because: refusal_when_own_networks_are_unknown });
  });
});

describe('an MCP server address on the public internet', () => {
  it.each([
    undefined,
    'allowed',
  ] as const)('is accepted on https under the rule %s', async (rule) => {
    expect(await judge('https://mcp.example.com/mcp#tools', rule)).toEqual({
      accepted: true,
      endpoint_url: 'https://mcp.example.com/mcp',
      host: 'mcp.example.com',
    });
  });

  it.each([
    undefined,
    'allowed',
  ] as const)('is refused on plain http under the rule %s', async (rule) => {
    expect(await judge('http://mcp.example.com/mcp', rule)).toEqual({
      accepted: false,
      because: 'The address must start with https://. Use the https address of this server.',
    });
  });

  it.each([
    ['https://rebound.example.com/mcp', undefined, 'Use an address on the public internet.'],
    ['https://half.example.com/mcp', undefined, 'Use an address on the public internet.'],
    ['https://rebound.example.com/mcp', 'allowed', 'Use the IP address of the server instead.'],
    ['https://half.example.com/mcp', 'allowed', 'Use the IP address of the server instead.'],
  ] as const)('refuses %s under the rule %s: a public name that points inside', async (url, rule, next_step) => {
    const verdict = await judge(url, rule);

    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.because).toContain('points to a private address, so Alfera did not use it.');
    expect(verdict.because).toContain(next_step);
  });

  it.each([
    ['not an address', /^That is not a web address\. Paste the full address/u],
    ['ftp://mcp.example.com/mcp', /^The address must start with https:\/\//u],
    ['https://me:secret@mcp.example.com/mcp', /^Take the username and password out/u],
    ['https://missing.example.com/mcp', /^Alfera could not find missing\.example\.com\. Check/u],
  ])('refuses %s with a sentence that says what to do', async (url, sentence) => {
    const verdict = await judge(url);

    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.because).toMatch(sentence);
    expect(verdict.because).toMatch(/^[A-Z].*\.$/u);
  });
});

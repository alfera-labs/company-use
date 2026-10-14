import { isIP } from 'node:net';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections } from '@coworker/core/db/schema';
import {
  good_api_key,
  stub_keyed_mcp_server,
} from '@runtime-platform/connections/__tests__/mcp_keyed_server_stub';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { inspect_mcp_server } from '@runtime-platform/connections/mcp_server_inspection';
import { sandbox_subnet_candidates } from '@runtime-platform/orchestrator/docker_sandbox_network';
import { runtime_add_mcp_server_tool } from '@runtime-platform/tools/definitions/runtime_add_mcp_server';
import { execute_mcp_tool } from '@runtime-platform/tools/mcp/mcp_executor';
import { send_mcp_request } from '@runtime-platform/tools/mcp/mcp_transport';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const install = vi.hoisted(() => {
  vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'docker');
  return {
    answers_by_name: {} as Record<string, string>,
    answers_in_turn: {} as Record<string, string[]>,
    names_that_cannot_be_found: [] as string[],
    lookups: [] as string[],
    interfaces: {} as Record<
      string,
      {
        cidr?: string | null;
        address?: string;
        netmask?: string;
        family?: string;
        internal: boolean;
      }[]
    >,
    docker_answer: { stdout: '' } as { stdout: string } | Error,
    docker_commands: [] as string[][],
  };
});

vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    install.lookups.push(host);
    if (install.names_that_cannot_be_found.includes(host)) throw new Error(`ENOTFOUND ${host}`);
    const next_in_turn = install.answers_in_turn[host]?.shift();
    const by_name = next_in_turn ?? install.answers_by_name[host] ?? '93.184.216.34';
    return [{ address: isIP(host) ? host : by_name }];
  },
}));

vi.mock('node:os', async (import_original) => ({
  ...(await import_original<typeof import('node:os')>()),
  networkInterfaces: () => install.interfaces,
}));

vi.mock('node:child_process', async (import_original) => ({
  ...(await import_original<typeof import('node:child_process')>()),
  execFile: (
    _command: string,
    command_arguments: string[],
    done: (error: Error | null, output?: { stdout: string; stderr: string }) => void,
  ) => {
    install.docker_commands.push(command_arguments);
    if (install.docker_answer instanceof Error) return done(install.docker_answer);
    return done(null, { stdout: install.docker_answer.stdout, stderr: '' });
  },
}));

function put_the_install_on_its_networks() {
  install.answers_by_name = { 'host.docker.internal': '0.250.250.254' };
  install.answers_in_turn = {};
  install.names_that_cannot_be_found = [];
  install.lookups = [];
  install.interfaces = {
    lo: [{ cidr: '127.0.0.1/8', internal: true }],
    eth0: [{ cidr: '172.18.0.3/16', internal: false }],
  };
  install.docker_answer = { stdout: '172.19.0.0/16 \n' };
  install.docker_commands = [];
}

const own_service =
  /^That address is one of Alfera's own services, so give the address of your own MCP server instead\.$/u;
const database_of_the_stack = 'http://172.18.0.2:5432/mcp';
const a_sandbox = 'http://172.19.0.5:3000/mcp';
const a_sandbox_on_a_named_range = `http://${sandbox_subnet_candidates[3]?.replace('.0/24', '.7')}:3000/mcp`;

const server_on_the_network = 'http://192.168.1.20:8000/mcp';
const server_on_this_machine = 'http://host.docker.internal:8000/mcp';
const cloud_metadata_address = 'http://169.254.169.254/latest/meta-data/';

const not_offered = /^Alfera cannot reach a server on your own machine or network\./u;
const switched_off =
  /are switched off on this install\. To allow them, run \.\/alfera add local-mcp/u;
const dashboard_only =
  /^Only an owner or an admin can add a server on your own machine or network\./u;

function run_as_a_self_hosted_install(private_addresses: 'open' | 'closed' | undefined) {
  vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
  if (private_addresses) vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', private_addresses);
}

async function create_workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return { db, workspace_id: bootstrap.workspace_id, user_id: bootstrap.user_id };
}

function add_in_the_dashboard(
  workspace: { db: Database; workspace_id: string; user_id: string },
  server_url: string,
) {
  return define_mcp_client_connection({
    db: workspace.db,
    workspace_id: workspace.workspace_id,
    actor_id: workspace.user_id,
    server_url,
    authentication: 'none',
    request_headers: { 'X-Api-Key': 'good-api-key' },
    redirect_uri: 'https://app.example.test/connect/callback',
    asked_by: 'administrator_in_dashboard',
  });
}

async function count_what_was_saved(db: Database) {
  return {
    servers: (await db.select().from(apps)).filter((app) => app.app_category === 'mcp').length,
    connections: (await db.select().from(connections)).length,
  };
}

beforeEach(put_the_install_on_its_networks);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'docker');
  vi.unstubAllGlobals();
});

describe('an MCP server on a private address', () => {
  it.each([
    server_on_the_network,
    server_on_this_machine,
  ])('is refused on the hosted product for an admin in the dashboard, whatever the setting says: %s', async (server_url) => {
    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, server_url);
    const inspection = await inspect_mcp_server({
      server_url,
      asked_by: 'administrator_in_dashboard',
    });

    expect(outcome).toEqual({ kind: 'refused', because: expect.stringMatching(not_offered) });
    expect(inspection).toEqual({ inspected: false, because: expect.stringMatching(not_offered) });
    expect(send).not.toHaveBeenCalled();
    expect(await count_what_was_saved(workspace.db)).toEqual({ servers: 0, connections: 0 });
  });

  it.each([
    undefined,
    'closed',
  ] as const)('is refused on a self-hosted install whose setting is %s, and the sentence names the switch', async (setting) => {
    run_as_a_self_hosted_install(setting);
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, server_on_the_network);
    const inspection = await inspect_mcp_server({
      server_url: server_on_the_network,
      asked_by: 'administrator_in_dashboard',
    });

    expect(outcome).toEqual({ kind: 'refused', because: expect.stringMatching(switched_off) });
    expect(inspection).toEqual({ inspected: false, because: expect.stringMatching(switched_off) });
    expect(send).not.toHaveBeenCalled();
    expect(await count_what_was_saved(workspace.db)).toEqual({ servers: 0, connections: 0 });
  });

  it.each([
    server_on_the_network,
    server_on_this_machine,
  ])('is refused for the coworker even when the operator switched it on, for an owner who asks in chat: %s', async (server_url) => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const result = await runtime_add_mcp_server_tool.execute({ server_url }, {
      db: workspace.db,
      workspace_id: workspace.workspace_id,
      session_id: 'ses_private_server_test',
      run_id: 'run_private_server_test',
      actor_id: workspace.user_id,
    } as RuntimeToolExecutionContext);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'mcp_server_refused', message: expect.stringMatching(dashboard_only) },
    });
    expect(send).not.toHaveBeenCalled();
    expect(await count_what_was_saved(workspace.db)).toEqual({ servers: 0, connections: 0 });
  });

  it('is refused for a caller that does not say who asks, even when the operator switched it on', async () => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await define_mcp_client_connection({
      db: workspace.db,
      workspace_id: workspace.workspace_id,
      actor_id: workspace.user_id,
      server_url: server_on_the_network,
      redirect_uri: 'https://app.example.test/connect/callback',
    });
    const inspection = await inspect_mcp_server({ server_url: server_on_the_network });

    expect(outcome).toEqual({ kind: 'refused', because: expect.stringMatching(dashboard_only) });
    expect(inspection).toEqual({
      inspected: false,
      because: expect.stringMatching(dashboard_only),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('is refused when it is a cloud metadata address, for an admin in the dashboard with the switch on', async () => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, cloud_metadata_address);
    const request = send_mcp_request(
      { endpoint_url: cloud_metadata_address, headers: {} },
      { id: 1, method: 'ping' },
    );

    expect(outcome).toEqual({
      kind: 'refused',
      because: expect.stringMatching(/^Alfera never sends a request to 169\.254\.169\.254\./u),
    });
    await expect(request).rejects.toThrow(/^No request was sent to the MCP server\. Alfera never/u);
    expect(send).not.toHaveBeenCalled();
    expect(await count_what_was_saved(workspace.db)).toEqual({ servers: 0, connections: 0 });
  });

  it.each([
    server_on_the_network,
    server_on_this_machine,
  ])('is added over plain http by an admin in the dashboard once the operator switched it on: %s', async (server_url) => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, server_url);

    expect(outcome).toMatchObject({ kind: 'connected', tool_count: 1 });
    expect(new Set(send.mock.calls.map(([url]) => String(url)))).toEqual(
      new Set([server_url.replace('host.docker.internal', '0.250.250.254')]),
    );
    expect(await count_what_was_saved(workspace.db)).toEqual({ servers: 1, connections: 1 });
  });

  it('gets no request any more once the operator switches it off again', async () => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();
    await add_in_the_dashboard(workspace, server_on_the_network);
    send.mockClear();

    vi.stubEnv('COWORKER_MCP_PRIVATE_ADDRESSES', 'closed');
    const request = send_mcp_request(
      { endpoint_url: server_on_the_network, headers: {} },
      { id: 1, method: 'ping' },
    );

    await expect(request).rejects.toThrow(
      /^No request was sent to the MCP server\. Servers on your own machine or network are switched off/u,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('gets no request when a public name the coworker added later points inside the network', async () => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    install.answers_by_name['mcp.acme.test'] = '192.168.1.20';

    const request = send_mcp_request(
      { endpoint_url: 'https://mcp.acme.test/mcp', headers: {} },
      { id: 1, method: 'ping' },
    );

    await expect(request).rejects.toThrow(/points to a private address, so Alfera did not use it/u);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['the database on the network of the stack', database_of_the_stack],
    ['a sandbox on the sandbox network', a_sandbox],
    ['a sandbox on a range the network takes when Docker has none', a_sandbox_on_a_named_range],
  ])('is refused when it is %s: at the check, at the add, and when a tool is called', async (_what, server_url) => {
    run_as_a_self_hosted_install('open');
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const inspection = await inspect_mcp_server({
      server_url,
      asked_by: 'administrator_in_dashboard',
    });
    const outcome = await add_in_the_dashboard(workspace, server_url);
    const tool_call = await execute_mcp_tool(
      { node_key: 'mcp_stack-read_note-1', tool_input: {} },
      {
        node_id: 'node_1',
        app_name: 'mcp_stack',
        node_name: 'read_note',
        runtime_handler: 'mcp.stack.read_note',
        node_config: { mcp: { endpoint_url: server_url } },
        connection_profile_key: null,
      },
      null,
    );

    expect(inspection).toEqual({ inspected: false, because: expect.stringMatching(own_service) });
    expect(outcome).toEqual({ kind: 'refused', because: expect.stringMatching(own_service) });
    expect(tool_call).toMatchObject({
      success: false,
      error: {
        code: 'mcp_unreachable',
        message: expect.stringMatching(
          /^No request was sent to the MCP server\. That address is one of Alfera's own services/u,
        ),
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(await count_what_was_saved(workspace.db)).toEqual({ servers: 0, connections: 0 });
  });

  it('asks Docker for the ranges of the sandbox network the install names', async () => {
    run_as_a_self_hosted_install('open');
    stub_keyed_mcp_server();

    await inspect_mcp_server({ server_url: a_sandbox, asked_by: 'administrator_in_dashboard' });

    expect(install.docker_commands).toEqual([
      [
        'network',
        'inspect',
        'alfera-sandbox',
        '--format',
        '{{range .IPAM.Config}}{{.Subnet}} {{end}}',
      ],
    ]);
  });

  it('reaches the machine itself by host.docker.internal, also when that address is inside the network of the stack', async () => {
    run_as_a_self_hosted_install('open');
    install.answers_by_name['host.docker.internal'] = '172.18.0.1';
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, server_on_this_machine);
    const next_to_it = await inspect_mcp_server({
      server_url: 'http://172.18.0.4:8000/mcp',
      asked_by: 'administrator_in_dashboard',
    });

    expect(outcome).toMatchObject({ kind: 'connected', tool_count: 1 });
    expect(new Set(send.mock.calls.map(([url]) => String(url)))).toEqual(
      new Set(['http://172.18.0.1:8000/mcp']),
    );
    expect(next_to_it).toEqual({ inspected: false, because: expect.stringMatching(own_service) });
  });

  it('still adds a server on the network when the sandbox network is not there yet', async () => {
    run_as_a_self_hosted_install('open');
    install.docker_answer = Object.assign(new Error('Command failed: docker network inspect'), {
      stderr: 'Error response from daemon: network alfera-sandbox not found',
    });
    stub_keyed_mcp_server();
    const workspace = await create_workspace();

    expect(await add_in_the_dashboard(workspace, server_on_the_network)).toMatchObject({
      kind: 'connected',
    });
    expect(await add_in_the_dashboard(workspace, database_of_the_stack)).toEqual({
      kind: 'refused',
      because: expect.stringMatching(own_service),
    });
  });

  it('sends nothing to any private address when Docker cannot say where the sandboxes are', async () => {
    run_as_a_self_hosted_install('open');
    install.docker_answer = Object.assign(new Error('Command failed: docker network inspect'), {
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
    });
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, server_on_the_network);
    const request = send_mcp_request(
      { endpoint_url: server_on_the_network, headers: {} },
      { id: 1, method: 'ping' },
    );

    expect(outcome).toEqual({
      kind: 'refused',
      because: expect.stringMatching(
        /^Alfera could not read its own networks, so it sent nothing/u,
      ),
    });
    await expect(request).rejects.toThrow(/Alfera could not read its own networks/u);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["one of Alfera's own services", '172.18.0.2'],
    ['a cloud metadata address', '169.254.169.254'],
  ])('sends each request to the address it checked, when the name answers %s the next time it is asked', async (_what, next_answer) => {
    run_as_a_self_hosted_install('open');
    install.answers_in_turn['notes.lan'] = ['192.168.1.20', next_answer];
    const send = stub_keyed_mcp_server();

    await send_mcp_request(
      { endpoint_url: 'http://notes.lan:8000/mcp', headers: { 'X-Api-Key': good_api_key } },
      { id: 1, method: 'initialize' },
    );

    expect(send.mock.calls.map(([url]) => String(url))).toEqual(['http://192.168.1.20:8000/mcp']);
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('host')).toBe('notes.lan:8000');
    expect(install.lookups.filter((host) => host === 'notes.lan')).toHaveLength(1);
  });

  it('sends every request of an add by name to the address it checked', async () => {
    run_as_a_self_hosted_install('open');
    install.answers_by_name['notes.lan'] = '192.168.1.20';
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, 'http://notes.lan:8000/mcp');

    expect(outcome).toMatchObject({ kind: 'connected', tool_count: 1 });
    expect(new Set(send.mock.calls.map(([url]) => String(url)))).toEqual(
      new Set(['http://192.168.1.20:8000/mcp']),
    );
    expect(
      new Set(send.mock.calls.map(([, init]) => new Headers(init?.headers).get('host'))),
    ).toEqual(new Set(['notes.lan:8000']));
  });

  it('sends nothing to a saved private server whose name cannot be looked up now', async () => {
    run_as_a_self_hosted_install('open');
    install.names_that_cannot_be_found = ['notes.lan'];
    const send = stub_keyed_mcp_server();

    const request = send_mcp_request(
      { endpoint_url: 'http://notes.lan:8000/mcp', headers: {} },
      { id: 1, method: 'ping' },
    );

    await expect(request).rejects.toThrow(
      /^No request was sent to the MCP server\. Alfera could not find notes\.lan/u,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses https to a private server by name, and sends https to a private address as it is', async () => {
    run_as_a_self_hosted_install('open');
    install.answers_by_name['notes.lan'] = '192.168.1.20';
    const send = stub_keyed_mcp_server();

    const by_name = await inspect_mcp_server({
      server_url: 'https://notes.lan/mcp',
      asked_by: 'administrator_in_dashboard',
    });
    await send_mcp_request(
      { endpoint_url: 'https://192.168.1.20/mcp', headers: { 'X-Api-Key': good_api_key } },
      { id: 1, method: 'initialize' },
    );

    expect(by_name).toEqual({
      inspected: false,
      because:
        'Alfera reaches a server on your own network by name over http only. Use http:// on a network you trust, or https:// with the IP address of the server.',
    });
    expect(send.mock.calls.map(([url]) => String(url))).toEqual(['https://192.168.1.20/mcp']);
  });

  it('refuses a name of the install with a dot at its end, when a tool is called', async () => {
    run_as_a_self_hosted_install('open');
    install.answers_by_name['api.'] = '192.168.1.20';
    install.answers_by_name.api = '192.168.1.20';
    const send = stub_keyed_mcp_server();

    const request = send_mcp_request(
      { endpoint_url: 'http://api.:3001/mcp', headers: {} },
      { id: 1, method: 'ping' },
    );

    await expect(request).rejects.toThrow(/api is a name inside Alfera's own network/u);
    expect(send).not.toHaveBeenCalled();
  });

  it('knows its own network from an interface that gives an address and a netmask but no range', async () => {
    run_as_a_self_hosted_install('open');
    install.interfaces = {
      eth0: [{ address: '172.18.0.3', netmask: '255.255.0.0', family: 'IPv4', internal: false }],
      eth1: [
        {
          address: 'fd4d:6169::3',
          netmask: 'ffff:ffff:ffff:ffff::',
          family: 'IPv6',
          cidr: null,
          internal: false,
        },
      ],
    };
    const send = stub_keyed_mcp_server();

    const inspections = await Promise.all(
      [database_of_the_stack, 'http://[fd4d:6169::9]:5432/mcp'].map((server_url) =>
        inspect_mcp_server({ server_url, asked_by: 'administrator_in_dashboard' }),
      ),
    );

    expect(inspections).toEqual([
      { inspected: false, because: expect.stringMatching(own_service) },
      { inspected: false, because: expect.stringMatching(own_service) },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing to a private address when the container shows no network of its own', async () => {
    run_as_a_self_hosted_install('open');
    install.interfaces = { lo: [{ cidr: '127.0.0.1/8', internal: true }] };
    const send = stub_keyed_mcp_server();
    const workspace = await create_workspace();

    const outcome = await add_in_the_dashboard(workspace, server_on_the_network);

    expect(outcome).toEqual({
      kind: 'refused',
      because: expect.stringMatching(
        /^Alfera could not read its own networks, so it sent nothing/u,
      ),
    });
    expect(send).not.toHaveBeenCalled();
  });
});

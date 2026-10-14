import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read_workos_auth: vi.fn(async () => ({ user: { id: 'user_1' } as { id: string } | null })),
  refresh_session_with_organization: vi.fn(async () => 'wos-session=pinned; Path=/; HttpOnly'),
  set_active_workspace: vi.fn(),
  create_workos_workspace: vi.fn(async () => ({ organizationId: 'org_new' })),
  create_personal_workos_workspace: vi.fn(async () => ({ organizationId: 'org_personal' })),
  setResponseHeader: vi.fn(),
}));

vi.mock('@/lib/workos_session', () => ({
  read_workos_auth: mocks.read_workos_auth,
  refresh_session_with_organization: mocks.refresh_session_with_organization,
}));
vi.mock('@/lib/workos_workspace_api', () => ({
  set_active_workspace: mocks.set_active_workspace,
  create_workos_workspace: mocks.create_workos_workspace,
  create_personal_workos_workspace: mocks.create_personal_workos_workspace,
}));
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}));

// createServerFn wires a handler into the RPC transport: the Start plugin moves the handler into
// its own module, the client calls it over HTTP, and the server runs it. None of that transport is
// under test here, so the builder is faked down to the handler itself and every assertion stays on
// the real handler body. The plugin calls `.handler(rpc_stub, handler)`; without the plugin the
// handler is the only argument, so the last one is the handler either way.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      middleware: () => builder,
      handler: (...args: Array<(input: { data?: unknown }) => unknown>) => {
        const handler = args.at(-1);
        if (!handler) throw new Error('createServerFn handler stub called without a handler');
        return Object.assign((input: { data?: unknown }) => handler(input), {
          __executeServer: (input: { data?: unknown }) => handler(input),
        });
      },
    };
    return builder;
  },
}));

// Under apps/app's vite config the Start plugin splits each handler into a `?tss-serverfn-split`
// provider module and renames the export; the repo-root vitest config runs without the plugin and
// keeps the server functions where they are. This import covers both.
// @ts-expect-error — the query-suffixed provider module has no type declarations; it resolves at
// runtime under both vitest configs (with and without the Start plugin).
const module_exports = (await import('@/lib/workspace_actions.ts?tss-serverfn-split')) as Record<
  string,
  (input: { data?: unknown }) => Promise<unknown>
>;

const switch_workspace = server_fn('switch_workspace');
const create_workspace = server_fn('create_workspace');

describe('workspace actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read_workos_auth.mockResolvedValue({ user: { id: 'user_1' } });
    mocks.refresh_session_with_organization.mockResolvedValue(
      'wos-session=pinned; Path=/; HttpOnly',
    );
    mocks.create_workos_workspace.mockResolvedValue({ organizationId: 'org_new' });
  });

  it('switch re-scopes the session and remembers the org per user via the API', async () => {
    await switch_workspace('org_target');

    expect(mocks.refresh_session_with_organization).toHaveBeenCalledWith('org_target');
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      'wos-session=pinned; Path=/; HttpOnly',
    );
    expect(mocks.set_active_workspace).toHaveBeenCalledWith({
      providerUserId: 'user_1',
      organizationId: 'org_target',
    });
  });

  it('create asks the API to make the workspace, then switches to it', async () => {
    const result = await create_workspace('Acme');

    expect(mocks.create_workos_workspace).toHaveBeenCalledWith({
      user: { id: 'user_1' },
      name: 'Acme',
    });
    expect(mocks.refresh_session_with_organization).toHaveBeenCalledWith('org_new');
    expect(result).toEqual({ organizationId: 'org_new' });
  });

  it('does not remember an organization when the session refresh rejects the switch', async () => {
    mocks.refresh_session_with_organization.mockRejectedValueOnce(new Error('Not a member'));

    await expect(switch_workspace('org_denied')).rejects.toThrow('Not a member');
    expect(mocks.set_active_workspace).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller before touching the session or the API', async () => {
    mocks.read_workos_auth.mockResolvedValue({ user: null });

    await expect(switch_workspace('org_target')).rejects.toThrow('Sign in to switch workspaces');
    expect(mocks.refresh_session_with_organization).not.toHaveBeenCalled();
    expect(mocks.set_active_workspace).not.toHaveBeenCalled();
  });

  it('fails when there is no live session to pin to the organization', async () => {
    mocks.refresh_session_with_organization.mockResolvedValue(undefined as never);

    await expect(switch_workspace('org_target')).rejects.toThrow(
      'No live session to pin to the organization',
    );
    expect(mocks.set_active_workspace).not.toHaveBeenCalled();
  });
});

function server_fn(name: string) {
  const handler = module_exports[`${name}_createServerFn_handler`] ?? module_exports[name];
  if (!handler) throw new Error(`workspace_actions does not export ${name}`);
  return (data: unknown) => handler({ data });
}

import { describe, expect, it, vi } from 'vitest';
import { is_onboarding_required_for_app } from '@/lib/onboarding_gate';

const read_workos_auth = vi.hoisted(() => vi.fn());

vi.mock('@/lib/workos_session', () => ({
  read_workos_auth,
}));

describe('the workspace gate read', () => {
  async function read_workspace(respond: () => Response) {
    vi.resetModules();
    read_workos_auth.mockResolvedValue({ user: null, organizationId: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond()),
    );

    const { get_workspace_on_server } = await import('@/lib/server_api');
    const workspace = await get_workspace_on_server();
    vi.unstubAllGlobals();
    return workspace;
  }

  it('returns the whole workspace, not just the gate flag', async () => {
    const workspace = await read_workspace(() =>
      Response.json({
        data: { workspace_id: 'ws_1', workspace_name: 'Acme', onboarding_completed: true },
      }),
    );

    expect(workspace).toMatchObject({ workspace_id: 'ws_1', workspace_name: 'Acme' });
    expect(is_onboarding_required_for_app(workspace)).toBe(false);
  });

  it('keeps an unfinished workspace in the wizard', async () => {
    const workspace = await read_workspace(() =>
      Response.json({ data: { workspace_id: 'ws_1', onboarding_completed: false } }),
    );

    expect(is_onboarding_required_for_app(workspace)).toBe(true);
  });

  it('treats a workspace with no onboarding flag as unfinished', async () => {
    const workspace = await read_workspace(() => Response.json({ data: { workspace_id: 'ws_1' } }));

    expect(is_onboarding_required_for_app(workspace)).toBe(true);
  });

  it('fails open when the API rejects the read', async () => {
    const workspace = await read_workspace(() =>
      Response.json({ error: { code: 'unauthorized' } }, { status: 401 }),
    );

    expect(workspace).toBeNull();
    expect(is_onboarding_required_for_app(workspace)).toBe(false);
  });

  it('fails open when the response carries no workspace', async () => {
    const workspace = await read_workspace(() => Response.json({}));

    expect(workspace).toBeNull();
    expect(is_onboarding_required_for_app(workspace)).toBe(false);
  });

  it('fails open when the API is unreachable', async () => {
    const workspace = await read_workspace(() => {
      throw new Error('ECONNREFUSED');
    });

    expect(workspace).toBeNull();
    expect(is_onboarding_required_for_app(workspace)).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', async (import_original) => {
  const actual = await import_original<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    api_client: {
      v1: {
        workspaces: {
          $get: async () =>
            new Response(
              JSON.stringify({
                data: {
                  workspaces: [
                    {
                      workspace_id: 'ws_1',
                      workspace_name: 'A',
                      workspace_slug: 'a',
                      organization_id: 'org_a',
                      member_role: 'owner',
                      is_active: true,
                    },
                  ],
                },
              }),
            ),
        },
      },
    },
    no_store_request: { init: {} },
  };
});

const { get_workspaces } = await import('@/lib/api/endpoints');

describe('get_workspaces', () => {
  it('returns the workspaces array from the envelope', async () => {
    const workspaces = await get_workspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.organization_id).toBe('org_a');
  });
});

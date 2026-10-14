import type { Database } from '@coworker/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  rename_workspace: vi.fn(),
  find_workspace_external_identity: vi.fn(),
}));

vi.mock('@coworker/core/db/queries/workspace_provisioning', async (import_original) => {
  const actual =
    await import_original<typeof import('@coworker/core/db/queries/workspace_provisioning')>();
  return {
    ...actual,
    rename_workspace: core.rename_workspace,
    find_workspace_external_identity: core.find_workspace_external_identity,
  };
});

const { rename_workspace } = await import('@api/services/workspace');

const db = {} as Database;
const input = { workspace_id: 'ws_1', workspace_name: 'Renamed', actor_id: 'user_1' };
const profile = {
  workspace_id: 'ws_1',
  workspace_name: 'Renamed',
  workspace_slug: 'renamed',
  onboarding_completed: true,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('rename_workspace service', () => {
  it('renames the row then updates the linked WorkOS organization name', async () => {
    core.rename_workspace.mockResolvedValue(profile);
    core.find_workspace_external_identity.mockResolvedValue({
      external_identity_provider: 'workos',
      external_identity_id: 'organization:org_123',
    });
    const update_workos_organization_name = vi.fn().mockResolvedValue(undefined);

    const result = await rename_workspace(db, input, { update_workos_organization_name });

    expect(result).toEqual(profile);
    expect(update_workos_organization_name).toHaveBeenCalledWith('org_123', 'Renamed');
  });

  it('skips WorkOS when the workspace is not a WorkOS organization', async () => {
    core.rename_workspace.mockResolvedValue(profile);
    core.find_workspace_external_identity.mockResolvedValue({
      external_identity_provider: 'slack',
      external_identity_id: 'organization:org_123',
    });
    const update_workos_organization_name = vi.fn();

    await rename_workspace(db, input, { update_workos_organization_name });

    expect(update_workos_organization_name).not.toHaveBeenCalled();
  });

  it('returns null and skips WorkOS when the workspace does not exist', async () => {
    core.rename_workspace.mockResolvedValue(null);
    const update_workos_organization_name = vi.fn();

    const result = await rename_workspace(db, input, { update_workos_organization_name });

    expect(result).toBeNull();
    expect(core.find_workspace_external_identity).not.toHaveBeenCalled();
    expect(update_workos_organization_name).not.toHaveBeenCalled();
  });

  it('still resolves the rename when the WorkOS update fails (best-effort)', async () => {
    core.rename_workspace.mockResolvedValue(profile);
    core.find_workspace_external_identity.mockResolvedValue({
      external_identity_provider: 'workos',
      external_identity_id: 'organization:org_123',
    });
    const update_workos_organization_name = vi.fn().mockRejectedValue(new Error('workos down'));
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await rename_workspace(db, input, { update_workos_organization_name });

    expect(result).toEqual(profile);
    expect(console_error).toHaveBeenCalled();
    console_error.mockRestore();
  });
});

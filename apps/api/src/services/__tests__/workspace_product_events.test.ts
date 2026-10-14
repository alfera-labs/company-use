import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture_product_event = vi.hoisted(() =>
  vi.fn<(input: { event: string }) => Promise<void>>(async () => {}),
);

vi.mock('@api/services/product_events', () => ({ capture_product_event }));
vi.mock('@api/services/provisioning/workspace_volume_provisioning', () => ({
  provision_workspace_volume: vi.fn(async () => null),
}));

const {
  create_user_workspace,
  provision_workspace_for_authenticated_user,
  sync_organization_membership,
} = await import('@api/services/workspace');

type ServiceDeps = Parameters<typeof provision_workspace_for_authenticated_user>[2];

function service_deps(overrides: Record<string, unknown> = {}) {
  return {
    update_workos_organization_name: vi.fn(),
    create_workos_organization: vi.fn(),
    find_workos_organization_by_external_id: vi.fn(),
    list_active_memberships_for_user: vi.fn(),
    create_admin_member_if_absent: vi.fn(async () => {}),
    promote_sole_member_to_admin: vi.fn(async () => {}),
    get_workos_user: vi.fn(async () => null),
    list_pending_workspace_invitations: vi.fn(async () => []),
    ...overrides,
  } as unknown as ServiceDeps;
}

const founder = {
  provider_key: 'workos',
  provider_user_id: 'user_workos_founder',
  organization_id: 'org_founder',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sent_event(name: string) {
  return capture_product_event.mock.calls.find(([input]) => input.event === name)?.[0];
}

describe('signup product events', () => {
  let db: Database;

  beforeEach(async () => {
    capture_product_event.mockClear();
    db = await create_test_database();
  });

  it('reports the signup and the first workspace on a new identity sign-in', async () => {
    const workspace = await provision_workspace_for_authenticated_user(db, founder, service_deps());
    await settle();

    const person = {
      distinct_id: 'user_workos_founder',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    };
    expect(capture_product_event).toHaveBeenCalledTimes(2);
    expect(sent_event('user_signed_up')).toMatchObject({
      person,
      properties: { workspace_id: workspace.workspace_id, joined_existing_workspace: false },
    });
    expect(sent_event('workspace_created')).toMatchObject({
      person,
      properties: { workspace_id: workspace.workspace_id, is_first_workspace: true },
    });
  });

  it('reports nothing when the same identity signs in again', async () => {
    await provision_workspace_for_authenticated_user(db, founder, service_deps());
    await settle();
    capture_product_event.mockClear();

    await provision_workspace_for_authenticated_user(db, founder, service_deps());
    await settle();

    expect(capture_product_event).not.toHaveBeenCalled();
  });

  it('reports a joined workspace, not a new one, for a user invited into an organization', async () => {
    await provision_workspace_for_authenticated_user(db, founder, service_deps());
    await settle();
    capture_product_event.mockClear();

    await sync_organization_membership(
      db,
      {
        action: 'upsert',
        provider_user_id: 'user_workos_invited',
        organization_id: founder.organization_id,
        role_slug: 'member',
      },
      service_deps({
        get_workos_user: vi.fn(async () => ({
          email: 'grace@example.com',
          first_name: 'Grace',
          last_name: 'Hopper',
        })),
      }),
    );
    await settle();

    expect(capture_product_event).toHaveBeenCalledTimes(1);
    expect(sent_event('user_signed_up')).toMatchObject({
      person: {
        distinct_id: 'user_workos_invited',
        email: 'grace@example.com',
        name: 'Grace Hopper',
      },
      properties: { joined_existing_workspace: true },
    });
  });

  it('reports a second named workspace as a workspace, not a signup', async () => {
    await provision_workspace_for_authenticated_user(db, founder, service_deps());
    await settle();
    capture_product_event.mockClear();

    await create_user_workspace(
      db,
      { identity: founder, name: 'Research' },
      service_deps({
        create_workos_organization: vi.fn(async () => ({ id: 'org_research', name: 'Research' })),
      }),
    );
    await settle();

    expect(capture_product_event).toHaveBeenCalledTimes(1);
    expect(sent_event('workspace_created')).toMatchObject({
      person: { distinct_id: 'user_workos_founder' },
      properties: { is_first_workspace: false },
    });
  });
});

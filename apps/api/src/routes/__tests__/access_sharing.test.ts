import {
  format_sharing_entry,
  read_sharing_entries,
  set_sharing_body_schema,
} from '@api/routes/access_sharing_schema';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { describe_resource_use } from '@coworker/core/access/describe_resource_use';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_project } from '@coworker/core/db/queries/projects';
import { replace_resource_sharing } from '@coworker/core/db/queries/resource_grants';
import { describe, expect, it } from 'vitest';

describe('the audience wire shape', () => {
  it('turns one PUT body into per-project and per-person rows the gate then enforces', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const project = await create_project(db, {
      workspace_id: bootstrap.workspace_id,
      project_name: 'Acme Support',
      actor_id: bootstrap.user_id,
      owner_id: bootstrap.user_id,
    });

    const body = set_sharing_body_schema.parse({
      shared_with_everyone_in_the_workspace: false,
      shared_with: [
        { project: project.project_id, can: 'use' },
        { person: 'usr_alice', can: 'use' },
      ],
    });

    await replace_resource_sharing(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'node',
      resource_id: 'issue_refund',
      shared_with: read_sharing_entries(body),
      actor_id: bootstrap.user_id,
    });

    const ask = (user: string[]) =>
      check_resource_use(db, {
        workspace_id: bootstrap.workspace_id,
        resource_type: 'node',
        resource_id: 'issue_refund',
        participants: { project: [project.project_id], agent: ['agt_ext'], user },
      });

    expect(await ask(['usr_alice'])).toEqual({ allowed: true, grant_level: 'use' });

    const with_bob = await ask(['usr_alice', 'usr_bob']);
    expect(with_bob.allowed).toBe(false);
    expect(
      describe_resource_use(with_bob, {
        resource_label: 'Issue refund',
        grantee_labels: { usr_bob: 'Bob' },
      }),
    ).toBe(
      'Issue refund is limited to specific people. Bob is in this chat and is not on its list.',
    );

    const elsewhere = await check_resource_use(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'node',
      resource_id: 'issue_refund',
      participants: { project: ['proj_other'], agent: ['agt_ext'], user: ['usr_alice'] },
    });
    expect(elsewhere).toMatchObject({ allowed: false, blocked_grantee_type: 'project' });
  });

  it('reads back in the same words it was written in', () => {
    expect(
      format_sharing_entry({ grantee_type: 'agent', grantee_id: 'agt_ext', grant_level: 'use' }),
    ).toEqual({ coworker: 'agt_ext', can: 'use' });
  });

  it('refuses a body that restricts a resource to nobody', () => {
    expect(
      set_sharing_body_schema.safeParse({
        shared_with_everyone_in_the_workspace: false,
        shared_with: [],
      }).success,
    ).toBe(false);
  });

  it('refuses a body that is shared with everyone AND names parties', () => {
    expect(
      set_sharing_body_schema.safeParse({
        shared_with_everyone_in_the_workspace: true,
        shared_with: [{ person: 'usr_alice', can: 'use' }],
      }).success,
    ).toBe(false);
  });
});

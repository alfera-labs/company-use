import { describe_resource_use } from '@coworker/core/access/describe_resource_use';
import {
  find_grant_level,
  type GrantRule,
  may_use_resource,
  type Participants,
} from '@coworker/core/access/may_use_resource';
import { describe, expect, it } from 'vitest';

function gathering(participants: Partial<Participants>): Participants {
  return { project: [], agent: [], user: [], ...participants };
}

const in_acme_support = gathering({
  project: ['proj_support'],
  agent: ['agt_ext'],
  user: ['usr_alice', 'usr_bob'],
});

const alice_alone = gathering({
  project: ['proj_support'],
  agent: ['agt_ext'],
  user: ['usr_alice'],
});

const alice_in_her_own_room = gathering({
  project: ['proj_alice_personal'],
  agent: ['agt_ext'],
  user: ['usr_alice'],
});

describe('may_use_resource', () => {
  it('allows a resource nobody restricted', () => {
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants: [],
      participants: in_acme_support,
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('denies a resource with no rows whose type defaults to nobody', () => {
    const verdict = may_use_resource({
      default_access: 'nobody',
      grants: [],
      participants: in_acme_support,
    });
    expect(verdict).toMatchObject({ allowed: false, denial_reason: 'nothing_is_granted' });
  });

  it('denies a project-limited resource outside that project', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'project', grantee_id: 'proj_support', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({
        project: ['proj_internal'],
        agent: ['agt_int'],
        user: ['usr_alice'],
      }),
    });
    expect(verdict).toMatchObject({
      allowed: false,
      denial_reason: 'not_on_the_list',
      blocked_grantee_type: 'project',
      blocked_grantee_ids: ['proj_internal'],
    });
  });

  it('denies a personally-granted resource when one person in the room lacks it', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: in_acme_support,
    });
    expect(verdict).toMatchObject({
      allowed: false,
      blocked_grantee_type: 'user',
      blocked_grantee_ids: ['usr_bob'],
    });
  });

  it('allows the same resource when that person is the only human present', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: alice_alone,
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('allows a personally-granted resource when EVERY person present holds it', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'use' },
      { grantee_type: 'user', grantee_id: 'usr_bob', grant_level: 'use' },
    ];
    expect(
      may_use_resource({
        default_access: 'everyone_in_the_workspace',
        grants,
        participants: in_acme_support,
      }),
    ).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('denies a personally-granted resource to a run with no people in it', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({ project: ['proj_support'], agent: ['agt_ext'], user: [] }),
    });
    expect(verdict).toMatchObject({
      allowed: false,
      denial_reason: 'nobody_present_to_check',
      blocked_grantee_type: 'user',
    });
  });

  it('denies a coworker outside the resource ceiling', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'agent', grantee_id: 'agt_hr', grant_level: 'use' },
    ];
    expect(
      may_use_resource({
        default_access: 'everyone_in_the_workspace',
        grants,
        participants: alice_alone,
      }),
    ).toMatchObject({
      allowed: false,
      blocked_grantee_type: 'agent',
      blocked_grantee_ids: ['agt_ext'],
    });
  });

  it('denies a delegation chain when only the parent coworker is granted', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'agent', grantee_id: 'agt_hr', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({
        project: ['proj_internal'],
        agent: ['agt_hr', 'agt_helper'],
        user: ['usr_alice'],
      }),
    });
    expect(verdict).toMatchObject({ allowed: false, blocked_grantee_ids: ['agt_helper'] });
  });

  it('allows the owner to use their connection in their own room, outside its granted projects', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'project', grantee_id: 'proj_marketing', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: alice_in_her_own_room,
      owner_user_id: 'usr_alice',
      room_private_to: 'usr_alice',
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'manage' });
  });

  it('refuses the owner solo-speaking in a shared room, where silent members read along', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'project', grantee_id: 'proj_marketing', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: alice_alone,
      owner_user_id: 'usr_alice',
      room_private_to: null,
    });
    expect(verdict).toMatchObject({
      allowed: false,
      denial_reason: 'not_on_the_list',
      blocked_grantee_type: 'project',
      blocked_grantee_ids: ['proj_support'],
    });
  });

  it('keeps the owner on their own connection in their own room when the rows name someone else', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_bob', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: alice_in_her_own_room,
      owner_user_id: 'usr_alice',
      room_private_to: 'usr_alice',
    });
    expect(verdict).toEqual({ allowed: true, grant_level: 'manage' });
  });

  it('does not widen the owner rule to a room the owner shares', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'project', grantee_id: 'proj_marketing', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: in_acme_support,
      owner_user_id: 'usr_alice',
    });
    expect(verdict).toMatchObject({ allowed: false, blocked_grantee_type: 'project' });
  });

  it('does not hand the owner rule to a chat in somebody else’s personal room', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'project', grantee_id: 'proj_marketing', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({ project: ['proj_bob_personal'], user: ['usr_alice'] }),
      owner_user_id: 'usr_alice',
      room_private_to: 'usr_bob',
    });
    expect(verdict).toMatchObject({ allowed: false, blocked_grantee_type: 'project' });
  });

  it('does not hand a scheduled run with no people the owner rule', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({ project: ['proj_alice_personal'], agent: ['agt_ext'], user: [] }),
      owner_user_id: 'usr_alice',
      room_private_to: 'usr_alice',
    });
    expect(verdict).toMatchObject({ allowed: false, denial_reason: 'nobody_present_to_check' });
  });

  it('denies a scope guarded only by source_actor grants when no source_actor is present', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'source_actor', grantee_id: 'sact_bot_1', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({ user: ['usr_alice'] }),
    });
    expect(verdict).toMatchObject({ allowed: false });
  });

  it('denies a scope guarded only by api_key grants when no api_key is present', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'api_key', grantee_id: 'key_ext_1', grant_level: 'use' },
    ];
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: gathering({ user: ['usr_alice'] }),
    });
    expect(verdict).toMatchObject({ allowed: false });
  });

  it('gives a gathering the weakest level any participant holds', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'manage' },
      { grantee_type: 'user', grantee_id: 'usr_bob', grant_level: 'use' },
    ];
    expect(
      may_use_resource({
        default_access: 'everyone_in_the_workspace',
        grants,
        participants: in_acme_support,
      }),
    ).toEqual({ allowed: true, grant_level: 'use' });
  });
});

describe('find_grant_level', () => {
  it('answers membership without requiring a coworker to be present', () => {
    const grants: GrantRule[] = [
      { grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'manage' },
      { grantee_type: 'agent', grantee_id: 'agt_ext', grant_level: 'use' },
    ];
    expect(find_grant_level(grants, 'user', 'usr_alice')).toBe('manage');
    expect(find_grant_level(grants, 'user', 'usr_bob')).toBeNull();
  });
});

describe('describe_resource_use', () => {
  it('names the people who blocked it, so the refusal says what to do next', () => {
    const verdict = may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants: [{ grantee_type: 'user', grantee_id: 'usr_alice', grant_level: 'use' }],
      participants: in_acme_support,
    });
    expect(
      describe_resource_use(verdict, {
        resource_label: 'Issue refund',
        grantee_labels: { usr_bob: 'Bob' },
      }),
    ).toBe(
      'Issue refund is limited to specific people. Bob is in this chat and is not on its list.',
    );
  });

  it('falls back to the id when a display name is missing', () => {
    const verdict = may_use_resource({
      default_access: 'nobody',
      grants: [],
      participants: in_acme_support,
    });
    expect(describe_resource_use(verdict, { resource_label: 'Acme Support' })).toBe(
      'Acme Support has no members yet, so nobody can open it.',
    );
  });
});

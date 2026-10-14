import { team_change_refusal } from '@api/services/team/team_change_refusal';
import { describe, expect, it } from 'vitest';

describe('who may change the team', () => {
  it('lets an owner make any change', () => {
    for (const current_role of ['owner', 'admin', 'member']) {
      expect(team_change_refusal('owner', { current_role, next_role: 'owner' })).toBeNull();
      expect(team_change_refusal('owner', { current_role })).toBeNull();
    }
    expect(team_change_refusal('owner', { next_role: 'owner' })).toBeNull();
  });

  it('lets an admin invite a member, and remove or re-invite a plain member', () => {
    expect(team_change_refusal('admin', { next_role: 'member' })).toBeNull();
    expect(team_change_refusal('admin', { current_role: 'member' })).toBeNull();
    expect(
      team_change_refusal('admin', { current_role: 'member', next_role: 'member' }),
    ).toBeNull();
  });

  it('stops an admin from touching an owner or another admin, and from handing out admin or owner', () => {
    expect(team_change_refusal('admin', { current_role: 'owner' })).toMatch(/Only an owner/);
    expect(team_change_refusal('admin', { current_role: 'admin' })).toMatch(/Only an owner/);
    for (const next_role of ['admin', 'owner']) {
      expect(team_change_refusal('admin', { next_role })).toMatch(/admin or an owner/);
      expect(team_change_refusal('admin', { current_role: 'member', next_role })).toMatch(
        /admin or an owner/,
      );
    }
  });

  it('lets only an owner make a sign-in link for a person who has already joined', () => {
    const link_for_a_joined_member = { current_role: 'member', signs_in_as_a_joined_person: true };
    expect(team_change_refusal('owner', link_for_a_joined_member)).toBeNull();
    expect(team_change_refusal('admin', link_for_a_joined_member)).toMatch(/already joined/);
  });

  it('stops a member, a stranger and an unknown role from every change', () => {
    for (const actor_role of ['member', 'viewer', '', null]) {
      expect(team_change_refusal(actor_role, { next_role: 'member' })).toMatch(/owner or an admin/);
      expect(team_change_refusal(actor_role, { current_role: 'member' })).toMatch(
        /owner or an admin/,
      );
    }
  });
});

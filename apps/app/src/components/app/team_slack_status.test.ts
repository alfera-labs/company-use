import { describe, expect, it } from 'vitest';
import { build_team_slack_status, slack_only_row_limit } from '@/components/app/team_slack_status';
import type { WorkspaceInvitation, WorkspaceMember } from '@/lib/api/endpoints';
import type { WorkspaceSlackPeople, WorkspaceSlackPerson } from '@/lib/api/workspace_slack_people';

function member(email: string, user_id = `usr_${email}`): WorkspaceMember {
  return { user_id, email, first_name: null, last_name: null, member_role: 'member' };
}

function invitation(email: string): WorkspaceInvitation {
  return { invitation_id: `invitation_${email}`, email, created_time: '2026-09-01T10:00:00.000Z' };
}

function slack_person(overrides: Partial<WorkspaceSlackPerson> = {}): WorkspaceSlackPerson {
  return {
    slack_user_id: 'U1',
    name: 'Nina Boro',
    email: 'nina@northwind.com',
    is_guest: false,
    ...overrides,
  };
}

function connected(people: WorkspaceSlackPerson[]): WorkspaceSlackPeople {
  return { connected: true, people };
}

function words_of(status: ReturnType<typeof build_team_slack_status>) {
  return Object.fromEntries(status.slack_word_by_user_id);
}

describe('the Slack word on a member row', () => {
  it('says In Slack when a Slack person has the same email, whatever the case or spacing', () => {
    const status = build_team_slack_status({
      members: [member(' Nina@Northwind.com ', 'usr_nina')],
      invitations: [],
      slack_people: connected([slack_person({ email: 'nina@NORTHWIND.com' })]),
    });

    expect(words_of(status)).toEqual({ usr_nina: 'In Slack' });
  });

  it('says Not in Slack when Slack is connected and nobody there has that email', () => {
    const status = build_team_slack_status({
      members: [member('nina@northwind.com', 'usr_nina'), member('omar@northwind.com', 'usr_omar')],
      invitations: [],
      slack_people: connected([slack_person({ email: 'nina@northwind.com' })]),
    });

    expect(words_of(status)).toEqual({ usr_nina: 'In Slack', usr_omar: 'Not in Slack' });
  });

  it.each<[string, WorkspaceSlackPeople | undefined]>([
    ['Slack is not connected', { connected: false, people: [] }],
    ['the Slack lookup failed', { connected: true, people: [], lookup_failed: true }],
    ['the Slack people are not loaded', undefined],
    ['Slack gave no email for anybody', connected([slack_person({ email: null })])],
  ])('says nothing and lists nobody when %s', (_case, slack_people) => {
    const status = build_team_slack_status({
      members: [member('nina@northwind.com')],
      invitations: [],
      slack_people,
    });

    expect(words_of(status)).toEqual({});
    expect(status.slack_only_people).toEqual([]);
    expect(status.slack_only_more_count).toBe(0);
  });
});

describe('the people who are in Slack only', () => {
  it.each([
    ['the members', { members: undefined, invitations: [] }],
    ['the invitations', { members: [], invitations: undefined }],
  ])('lists nobody until %s are loaded', (_case, team) => {
    const status = build_team_slack_status({ ...team, slack_people: connected([slack_person()]) });

    expect(status.slack_only_people).toEqual([]);
    expect(words_of(status)).toEqual({});
  });

  it('leaves out members and people with a pending invitation, whatever the case', () => {
    const dana = slack_person({
      slack_user_id: 'U3',
      name: 'Dana Wu',
      email: 'dana@northwind.com',
    });
    const status = build_team_slack_status({
      members: [member('NINA@northwind.com')],
      invitations: [invitation('Omar@Northwind.com')],
      slack_people: connected([
        slack_person({ slack_user_id: 'U1', email: 'nina@northwind.com' }),
        slack_person({ slack_user_id: 'U2', name: 'Omar Said', email: 'omar@northwind.com' }),
        dana,
      ]),
    });

    expect(status.slack_only_people).toEqual([dana]);
    expect(status.slack_only_more_count).toBe(0);
  });

  it('keeps the guest mark and keeps a person Slack gave no email for', () => {
    const guest = slack_person({
      slack_user_id: 'U2',
      name: 'Dana Agency',
      email: 'dana@agency.com',
      is_guest: true,
    });
    const no_email = slack_person({ slack_user_id: 'U3', name: 'Sam Visitor', email: null });
    const status = build_team_slack_status({
      members: [member('nina@northwind.com')],
      invitations: [],
      slack_people: connected([slack_person(), guest, no_email]),
    });

    expect(status.slack_only_people).toEqual([guest, no_email]);
  });

  it('is empty when every Slack person is a member or invited', () => {
    const status = build_team_slack_status({
      members: [member('nina@northwind.com')],
      invitations: [],
      slack_people: connected([slack_person()]),
    });

    expect(status.slack_only_people).toEqual([]);
  });

  it('orders the people by name', () => {
    const status = build_team_slack_status({
      members: [],
      invitations: [],
      slack_people: connected([
        slack_person({ slack_user_id: 'U1', name: 'Zoe', email: 'zoe@northwind.com' }),
        slack_person({ slack_user_id: 'U2', name: 'adam', email: 'adam@northwind.com' }),
        slack_person({ slack_user_id: 'U3', name: 'Mia', email: 'mia@northwind.com' }),
      ]),
    });

    expect(status.slack_only_people.map((person) => person.name)).toEqual(['adam', 'Mia', 'Zoe']);
  });

  function many_slack_people(count: number) {
    return Array.from({ length: count }, (_, index) =>
      slack_person({
        slack_user_id: `U${index}`,
        name: `Person ${String(index).padStart(3, '0')}`,
        email: `person${index}@northwind.com`,
      }),
    );
  }

  it('stops at 50 rows and counts the rest', () => {
    const status = build_team_slack_status({
      members: [],
      invitations: [],
      slack_people: connected(many_slack_people(63)),
    });

    expect(slack_only_row_limit).toBe(50);
    expect(status.slack_only_people).toHaveLength(50);
    expect(status.slack_only_people.at(-1)?.name).toBe('Person 049');
    expect(status.slack_only_more_count).toBe(13);
  });

  it('counts nothing more when exactly 50 people are in Slack only', () => {
    const status = build_team_slack_status({
      members: [],
      invitations: [],
      slack_people: connected(many_slack_people(50)),
    });

    expect(status.slack_only_people).toHaveLength(50);
    expect(status.slack_only_more_count).toBe(0);
  });
});

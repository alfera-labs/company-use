import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TeamSettings } from '@/components/app/team_settings';
import type { WorkspaceInvitation, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { WorkspaceSlackPeople } from '@/lib/api/workspace_slack_people';

vi.mock('@/lib/auth_client', () => ({
  useAuth: () => ({ user: { email: 'robin@northwind.com' } }),
}));

function member(overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    user_id: 'usr_robin',
    email: 'robin@northwind.com',
    first_name: 'Robin',
    last_name: 'Tate',
    member_role: 'owner',
    ...overrides,
  };
}

const pending: WorkspaceInvitation = {
  invitation_id: 'invitation_1',
  email: 'nina@northwind.com',
  role_slug: 'member',
  created_time: '2026-09-01T10:00:00.000Z',
};

function render_panel(
  members: WorkspaceMember[],
  invitations: WorkspaceInvitation[],
  slack_people?: WorkspaceSlackPeople,
) {
  const client = new QueryClient();
  client.setQueryData(query_keys.workspace_members(), members);
  client.setQueryData(query_keys.workspace_invitations(), invitations);
  if (slack_people) client.setQueryData(query_keys.workspace_slack_people(), slack_people);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(TeamSettings)),
  );
}

describe('the team settings panel', () => {
  it('names each member, their seat, and which one is you', () => {
    const html = render_panel(
      [
        member(),
        member({
          user_id: 'usr_nina',
          email: 'nina@northwind.com',
          first_name: 'Nina',
          last_name: 'Boro',
          member_role: 'member',
        }),
      ],
      [],
    );

    expect(html).toContain('Robin Tate');
    expect(html).toContain('Owner');
    expect(html).toContain('Nina Boro');
    expect(html).toContain('Member');
    expect(html).toContain('You');
  });

  it('shows a pending invitation with a way to withdraw it', () => {
    const html = render_panel([member()], [pending]);

    expect(html).toContain('nina@northwind.com');
    expect(html).toContain('Invited');
    expect(html).toContain('aria-label="Withdraw the invitation to nina@northwind.com"');
  });

  it('offers the invite row whenever the panel is shown', () => {
    const html = render_panel([member()], []);

    expect(html).toContain('aria-label="Teammate email"');
    expect(html).toContain('aria-label="What they can do"');
    expect(html).toContain('Invite');
  });

  it('says so when the workspace is one person and nobody has been invited', () => {
    const html = render_panel([member()], []);

    expect(html).toContain('It is just you here.');
  });

  it('drops the sentence once a teammate has been invited', () => {
    expect(render_panel([member()], [pending])).not.toContain('It is just you here.');
  });

  const nina = member({
    user_id: 'usr_nina',
    email: 'nina@northwind.com',
    first_name: 'Nina',
    last_name: 'Boro',
    member_role: 'member',
  });

  it('says on each member row whether that person is in Slack', () => {
    const html = render_panel([member(), nina], [], {
      connected: true,
      people: [
        { slack_user_id: 'U1', name: 'Robin Tate', email: 'Robin@Northwind.com', is_guest: false },
      ],
    });

    expect(html).toContain('robin@northwind.com · In Slack');
    expect(html).toContain('nina@northwind.com · Not in Slack');
    expect(html).not.toContain('In Slack only');
  });

  it('lists the people who are in Slack only, with a way to invite each one', () => {
    const html = render_panel([member()], [pending], {
      connected: true,
      people: [
        { slack_user_id: 'U1', name: 'Robin Tate', email: 'robin@northwind.com', is_guest: false },
        { slack_user_id: 'U2', name: 'Nina Boro', email: 'nina@northwind.com', is_guest: false },
        { slack_user_id: 'U3', name: 'Dana Wu', email: 'dana@agency.com', is_guest: true },
        { slack_user_id: 'U4', name: 'Sam Visitor', email: null, is_guest: false },
      ],
    });
    const slack_only_html = html.slice(html.indexOf('In Slack only'));

    expect(html).toContain('In Slack only');
    expect(slack_only_html).toContain('Dana Wu');
    expect(slack_only_html).toContain('dana@agency.com · Guest');
    expect(slack_only_html).toContain('aria-label="Invite dana@agency.com"');
    expect(slack_only_html).toContain('Sam Visitor');
    expect(slack_only_html).not.toContain('Nina Boro');
    expect(slack_only_html).not.toContain('nina@northwind.com');
    expect(slack_only_html.match(/aria-label="Invite /g)).toHaveLength(1);
    expect(slack_only_html).not.toContain(' more');
  });

  it('says how many more people are in Slack only after 50 rows', () => {
    const people = Array.from({ length: 52 }, (_, index) => ({
      slack_user_id: `U${index}`,
      name: `Person ${index}`,
      email: `person${index}@northwind.com`,
      is_guest: false,
    }));

    const html = render_panel([member()], [], { connected: true, people });

    expect(html.match(/aria-label="Invite /g)).toHaveLength(50);
    expect(html).toContain('and 2 more');
  });

  it.each<[string, WorkspaceSlackPeople | undefined]>([
    ['Slack is not connected', { connected: false, people: [] }],
    ['the Slack lookup failed', { connected: true, people: [], lookup_failed: true }],
    ['the Slack people are not loaded', undefined],
  ])('looks the same as before when %s', (_case, slack_people) => {
    const html = render_panel([member(), nina], [pending], slack_people);

    expect(html).not.toContain('Slack');
    expect(html).toContain(
      '<p class="truncate text-muted-foreground text-xs">nina@northwind.com</p>',
    );
  });
});

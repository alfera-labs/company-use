import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TeamModeMemberRow } from '@/components/app/team_mode_member_row';
import { is_the_only_owner, only_owner_stays_words } from '@/components/app/team_mode_words';
import { use_team_changes } from '@/components/app/use_team_mode';
import type { TeamMember } from '@/lib/api/team_mode';

function person(user_id: string, member_role: string, member_status = 'active'): TeamMember {
  return { user_id, first_name: user_id, last_name: null, member_role, member_status };
}

function RowWithItsChanges(row: { member: TeamMember; all_members: TeamMember[] }) {
  const changes = use_team_changes(() => {});
  return createElement(TeamModeMemberRow, { ...row, is_you: true, viewer_role: 'owner', changes });
}

function row_of(member: TeamMember, all_members: TeamMember[]) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(RowWithItsChanges, { member, all_members }),
    ),
  );
}

function remove_button_of(html: string) {
  const button = html.match(/<button[^>]*>Remove<\/button>/u)?.[0];
  if (!button) return 'missing';
  return / disabled=""/u.test(button) ? 'disabled' : 'enabled';
}

describe('the row of the only owner on the Team page', () => {
  const owner = person('Robin', 'owner');

  it('offers no removal and no other role, and says why in one sentence', () => {
    const html = row_of(owner, [owner, person('Dana', 'member')]);

    expect(remove_button_of(html)).toBe('disabled');
    expect(html).toContain(only_owner_stays_words);
  });

  it('offers both again once a second owner has joined', () => {
    const html = row_of(owner, [owner, person('Sam', 'owner')]);

    expect(remove_button_of(html)).toBe('enabled');
    expect(html).not.toContain(only_owner_stays_words);
  });

  it('does not count an owner who is only invited', () => {
    const invited = person('Sam', 'owner', 'invited');

    expect(is_the_only_owner(owner, [owner, invited])).toBe(true);
    expect(is_the_only_owner(invited, [owner, invited])).toBe(false);
    expect(is_the_only_owner(person('Dana', 'member'), [owner])).toBe(false);
  });
});

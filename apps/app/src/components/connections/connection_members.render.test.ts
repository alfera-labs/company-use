import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionPeople } from '@/components/connections/connection_members';
import type { ResourceSharing, SharingGrantee, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

const members: WorkspaceMember[] = [
  {
    user_id: 'usr_robin',
    email: 'robin@northwind.com',
    first_name: 'Robin',
    last_name: 'Tate',
    member_role: 'owner',
  },
  {
    user_id: 'usr_nina',
    email: 'nina@northwind.com',
    first_name: 'Nina',
    last_name: 'Boro',
    member_role: 'member',
  },
];

function render_people(...shared_with: SharingGrantee[]) {
  const sharing: ResourceSharing = {
    resource_type: 'connection',
    shared_with_everyone_in_the_workspace: shared_with.length === 0,
    shared_with,
  };
  const client = new QueryClient();
  client.setQueryData(query_keys.workspace_members(), members);
  client.setQueryData(query_keys.workspace(), {
    workspace_name: 'Northwind',
    viewer_user_id: 'usr_robin',
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConnectionPeople, { connection_id: 'conn_github', sharing }),
    ),
  );
}

describe('the people named on a connection', () => {
  it('lists each named person and offers to add the teammates who are not named yet', () => {
    const html = render_people({ person: 'usr_robin', can: 'use' });

    expect(html).toContain('Robin Tate');
    expect(html).toContain('(you)');
    expect(html).toContain('aria-label="Remove Robin Tate"');
    expect(html).toContain('Add a person');
    expect(html).not.toContain('aria-label="Remove Nina Boro"');
  });

  it('offers nobody to add when every teammate is already named', () => {
    const html = render_people(
      { person: 'usr_robin', can: 'use' },
      { person: 'usr_nina', can: 'use' },
    );

    expect(html).toContain('aria-label="Remove Nina Boro"');
    expect(html).not.toContain('Add a person');
  });

  it('shows no list when the connection is open to everyone or to projects', () => {
    expect(render_people()).toBe('');
    expect(render_people({ project: 'proj_phoenix', can: 'use' })).toBe('');
  });
});

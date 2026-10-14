import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionAudienceForViewer } from '@/components/app/connection_audience_for_viewer';
import type { ResourceSharing, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import { AppAuthProvider } from '@/lib/auth_client';

const robin: WorkspaceMember = {
  user_id: 'usr_robin',
  email: 'robin@northwind.com',
  first_name: 'Robin',
  last_name: 'Tate',
  member_role: 'owner',
};
const ada: WorkspaceMember = { ...robin, user_id: 'usr_ada', first_name: 'Ada', last_name: 'Ng' };
const open_to_everyone: ResourceSharing = {
  resource_type: 'connection',
  shared_with_everyone_in_the_workspace: true,
  shared_with: [],
};
const menu_button = 'aria-label="Who can use this connection"';

function audience_shown_to(viewer_role: string, owner_user_id: string) {
  const viewer = { ...ada, member_role: viewer_role };
  const client = new QueryClient();
  client.setQueryData(query_keys.projects(''), []);
  client.setQueryData(query_keys.workspace_members(), [robin, viewer]);
  client.setQueryData(query_keys.workspace(), {
    workspace_name: 'Northwind',
    viewer_user_id: viewer.user_id,
  });
  const audience = createElement(ConnectionAudienceForViewer, {
    connection_id: 'conn_1',
    owner_user_id,
    sharing: open_to_everyone,
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(AppAuthProvider, null, audience)),
  );
}

describe('who gets the menu that changes who can use a connection', () => {
  it('shows a member the audience of a connection another person made, with nothing to press', () => {
    const html = audience_shown_to('member', robin.user_id);

    expect(html).toContain('Everyone');
    expect(html).not.toContain('<button');
    expect(html).toContain('Robin owns this connection. Ask them or an admin to change it.');
  });

  it('gives the menu to an admin, and to the member who made the connection', () => {
    expect(audience_shown_to('admin', robin.user_id)).toContain(menu_button);
    expect(audience_shown_to('member', ada.user_id)).toContain(menu_button);
  });
});

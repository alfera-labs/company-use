import { proxy_auth_headers } from '@api/lib/proxy_identity';
import {
  type ApiApp,
  describe_two_people_sharing_a_room,
} from '@api/routes/__tests__/two_people_share_a_room';

const proxy_secret = 'local-development-internal-api-secret';

function identity_headers(person: { user: string; email: string; organization: string }) {
  return {
    'Content-Type': 'application/json',
    [proxy_auth_headers.secret]: proxy_secret,
    [proxy_auth_headers.provider_key]: 'workos',
    [proxy_auth_headers.provider_user_id]: person.user,
    [proxy_auth_headers.organization_id]: person.organization,
    [proxy_auth_headers.email]: person.email,
    [proxy_auth_headers.first_name]: 'Robin',
    [proxy_auth_headers.last_name]: 'Tate',
  };
}

const owner = identity_headers({
  user: 'wos_user_owner',
  email: 'owner@team.test',
  organization: 'org_team_test',
});
const teammate = identity_headers({
  user: 'wos_user_teammate',
  email: 'teammate@team.test',
  organization: 'org_team_test',
});
const stranger = identity_headers({
  user: 'wos_user_stranger',
  email: 'stranger@other.test',
  organization: 'org_other_test',
});

describe_two_people_sharing_a_room('a team walks the whole path', async () => {
  const { create_app } = await import('@api/app');
  const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
  const app = create_app(await create_test_database()) as ApiApp;
  await app.request('/v1/workspace', { headers: owner });
  const members = await app.request('/v1/workspace/members', { headers: teammate });
  const teammate_user_id = (await members.json()).data.members.find(
    (member: { email: string }) => member.email === 'teammate@team.test',
  ).user_id;
  return { app, owner, teammate, stranger, teammate_user_id };
});

import { proxy_auth_headers } from '@api/lib/proxy_identity';
import {
  type ApiApp,
  describe_two_people_sharing_a_room,
} from '@api/routes/__tests__/two_people_share_a_room';
import { afterAll, beforeAll, vi } from 'vitest';

const machine = {
  'Content-Type': 'application/json',
  [proxy_auth_headers.secret]: 'local-development-internal-api-secret',
};

function as_person(user_id: string) {
  return {
    ...machine,
    [proxy_auth_headers.provider_key]: 'workos',
    [proxy_auth_headers.provider_user_id]: user_id,
    [proxy_auth_headers.organization_id]: 'org_local',
  };
}

async function data_of(response: Response) {
  return (await response.json()).data;
}

async function join_with(app: ApiApp, token: string): Promise<string> {
  const redeemed = await app.request('/v1/team-sign-in/link/redeem', {
    method: 'POST',
    headers: machine,
    body: JSON.stringify({ token }),
  });
  const session = await app.request('/v1/team-sign-in/session', {
    method: 'POST',
    headers: machine,
    body: JSON.stringify({ session_token: (await data_of(redeemed)).session_token }),
  });
  return (await data_of(session)).user_id;
}

beforeAll(() => {
  vi.stubEnv('COWORKER_AUTH_MODE', 'team');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe_two_people_sharing_a_room(
  'two people of a team-mode install walk the same path',
  async () => {
    const { create_app } = await import('@api/app');
    const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
    const app = create_app(await create_test_database()) as ApiApp;

    const owner_link = await app.request('/v1/team-sign-in/owner-link', {
      method: 'POST',
      headers: machine,
    });
    const owner_user_id = await join_with(app, (await data_of(owner_link)).token);
    const invited = await app.request('/v1/team/invitations', {
      method: 'POST',
      headers: as_person(owner_user_id),
      body: JSON.stringify({ name: 'Teammate', role: 'member' }),
    });
    const teammate_user_id = await join_with(app, (await data_of(invited)).sign_in_link.token);

    return {
      app,
      owner: as_person(owner_user_id),
      teammate: as_person(teammate_user_id),
      teammate_user_id,
    };
  },
);

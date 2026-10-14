import {
  as_person,
  call,
  invite_and_join,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

describe('the address a team install is opened at', () => {
  it('tells the team page the address from the install settings, whatever address asked', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://192.168.1.20:3000');
    vi.stubEnv('APP_BIND', '0.0.0.0');
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Ada', 'member');
    const asked_on_localhost = { ...as_person(owner.user_id), host: 'localhost:3000' };

    const team = await call('GET', '/v1/team', asked_on_localhost);
    const as_member = await call('GET', '/v1/team', as_person(member.user_id));

    const open_at = { address: 'http://192.168.1.20:3000', who_can_open: 'other_machines' };
    expect(team.data.open_at).toEqual(open_at);
    expect(as_member.data.open_at).toEqual(open_at);
  });

  it('says only this machine can open it until the install is opened to others', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('APP_BIND', '127.0.0.1');
    const owner = await sign_the_owner_in();

    const team = await call('GET', '/v1/team', as_person(owner.user_id));

    expect(team.data.open_at).toEqual({
      address: 'http://localhost:3000',
      who_can_open: 'this_machine_only',
    });
  });

  it('still says only this machine when the port is open and the address is localhost', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3360');
    vi.stubEnv('APP_BIND', '0.0.0.0');
    const owner = await sign_the_owner_in();

    const team = await call('GET', '/v1/team', as_person(owner.user_id));

    expect(team.data.open_at).toEqual({
      address: 'http://localhost:3360',
      who_can_open: 'this_machine_only',
    });
  });
});

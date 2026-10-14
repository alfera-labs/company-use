import {
  finish_setup,
  owner,
  use_a_fresh_install_waiting_for_setup,
} from '@api/routes/__tests__/install_setup_install';
import { as_person, call, invite_and_join, sign_in } from '@api/routes/__tests__/team_mode_install';
import { describe, expect, it } from 'vitest';

use_a_fresh_install_waiting_for_setup();

const path = '/v1/sign-in-password';

async function signed_in_owner() {
  const { session_token, recovery_code } = await finish_setup();
  const person = await sign_in('session', { session_token });
  return { user_id: person.data.user_id as string, recovery_code };
}

describe('a new recovery code made in Settings', () => {
  it('needs the password again, is shown once, and the old code stops working', async () => {
    const { user_id, recovery_code } = await signed_in_owner();
    const refused = await call('POST', `${path}/recovery-code`, as_person(user_id), {
      password: 'not the password',
    });
    expect(refused.error?.code).toBe('password_refused');

    const made = await call('POST', `${path}/recovery-code`, as_person(user_id), {
      password: owner.password,
    });
    expect(made.status).toBe(201);
    const new_code = made.data.recovery_code as string;
    expect(new_code).not.toBe(recovery_code);

    const recover = (code: string) =>
      sign_in('password/recover', {
        email: owner.email,
        recovery_code: code,
        new_password: 'another long password',
      });
    expect((await recover(recovery_code)).error?.code).toBe('recovery_refused');
    expect((await recover(new_code)).status).toBe(201);
  });

  it('tells a person with no password that there is none, and makes them no code', async () => {
    const { user_id } = await signed_in_owner();
    const member = await invite_and_join(user_id, 'Grace', 'member');
    const state = await call('GET', path, as_person(member.user_id));
    expect(state.data.has_password).toBe(false);
    const made = await call('POST', `${path}/recovery-code`, as_person(member.user_id), {
      password: owner.password,
    });
    expect(made.error?.code).toBe('password_refused');
  });
});

import { proxy_auth_headers } from '@api/lib/proxy_identity';
import {
  anthropic_key,
  finish_setup,
  owner,
  setup,
  use_a_fresh_install_waiting_for_setup,
} from '@api/routes/__tests__/install_setup_install';
import { as_person, call, db, machine, sign_in } from '@api/routes/__tests__/team_mode_install';
import { upsert_model_provider_account } from '@coworker/core/db/queries/model_provider_accounts';
import { install_connections } from '@coworker/core/db/schema';
import { read_workspace_model_environment } from '@coworker/runtime-platform';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_install_waiting_for_setup();

async function workspace_of(session_token: string) {
  const person = await sign_in('session', { session_token });
  const member = await db.query.workspace_members.findFirst({
    where: (members, { eq }) => eq(members.user_id, person.data.user_id as string),
  });
  return { user_id: person.data.user_id as string, workspace_id: member?.workspace_id ?? '' };
}

describe('two people on the setup page at once', () => {
  it('makes one owner, and the owner signs in with the email that won', async () => {
    const second = { ...owner, email: 'second@example.com' };
    const attempts = await Promise.all([setup('owner', owner), setup('owner', second)]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 410]);
    const winner = attempts[0]?.status === 201 ? owner : second;
    const loser = winner === owner ? second : owner;
    const signs_in = (email: string) =>
      sign_in('password', { email, password: owner.password }).then((answer) => answer.status);
    expect([await signs_in(winner.email), await signs_in(loser.email)]).toEqual([201, 401]);
  });

  it('does not let a key check that ends after the owner exists replace the key', async () => {
    await finish_setup();
    const late = await setup('ai-key', { api_key: `sk-ant-api03-${'z'.repeat(40)}` });
    expect(late.status).toBe(410);
    const [row] = await db.select().from(install_connections);
    expect(row?.connection_metadata).toMatchObject({ secret_hint: 'kkkk' });
  });
});

describe('one recovery code', () => {
  it('sets a new password once, even when it is sent twice at the same time', async () => {
    const { recovery_code } = await finish_setup();
    const reset = (new_password: string) =>
      sign_in('password/recover', { email: owner.email, recovery_code, new_password });
    const answers = await Promise.all([reset('first new password'), reset('second new password')]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 401]);
  });
});

describe('who is counted for too many tries', () => {
  it('counts guesses for one email from every address, and leaves other emails alone', async () => {
    await finish_setup();
    const from = (address: string) => ({ ...machine, [proxy_auth_headers.client_ip]: address });
    const wrong = { email: owner.email, password: 'wrong' };
    for (let attempt = 0; attempt < 101; attempt += 1) {
      await call('POST', '/v1/team-sign-in/password', from(`203.0.113.${attempt}`), wrong);
    }
    const same_email = await call('POST', '/v1/team-sign-in/password', from('198.51.100.4'), wrong);
    const other_email = await call('POST', '/v1/team-sign-in/password', from('198.51.100.5'), {
      email: 'someone-else@example.com',
      password: 'wrong',
    });
    expect([same_email.error?.code, other_email.error?.code]).toEqual([
      'rate_limited',
      'sign_in_refused',
    ]);
  }, 60_000);
});

describe('which key a run uses', () => {
  it('takes the workspace key over the server key, and the server key over .env', async () => {
    const { session_token } = await finish_setup();
    const { user_id, workspace_id } = await workspace_of(session_token);
    const env = { ANTHROPIC_API_KEY: 'from-env', OPENAI_API_KEY: 'openai-from-env' };
    const before = await read_workspace_model_environment(db, workspace_id, env);
    expect(before.environment.ANTHROPIC_API_KEY).toBe(anthropic_key);
    expect(before.environment.OPENAI_API_KEY).toBe('openai-from-env');

    const workspace_key = `sk-ant-api03-${'w'.repeat(40)}`;
    await upsert_model_provider_account(db, {
      workspace_id,
      provider_slot: 'anthropic',
      api_key: workspace_key,
      actor_id: user_id,
    });
    const after = await read_workspace_model_environment(db, workspace_id, env);
    expect(after.environment.ANTHROPIC_API_KEY).toBe(workspace_key);
    expect((await call('GET', '/v1/workspace', as_person(user_id))).status).toBe(200);
  });

  it('reads no server key on an install that signs people in another way', async () => {
    const { session_token } = await finish_setup();
    const { workspace_id } = await workspace_of(session_token);
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const model = await read_workspace_model_environment(db, workspace_id, {});
    expect(model.environment.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

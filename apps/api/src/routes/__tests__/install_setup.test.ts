import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import {
  answer_provider_checks,
  anthropic_key,
  finish_setup,
  owner,
  setup,
  setup_install,
  use_a_fresh_install_waiting_for_setup,
} from '@api/routes/__tests__/install_setup_install';
import {
  as_person,
  call,
  db,
  invite_and_join,
  machine,
  sign_in,
} from '@api/routes/__tests__/team_mode_install';
import { install_connections, user_passwords } from '@coworker/core/db/schema';
import { read_workspace_model_environment } from '@coworker/runtime-platform';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_install_waiting_for_setup();

describe('the setup token', () => {
  it('opens setup only with the token whose hash the installer wrote', async () => {
    expect((await setup('check', {})).status).toBe(200);
    const wrong = await call('POST', '/v1/setup/check', machine, {
      setup_token: randomBytes(32).toString('base64url'),
    });
    expect(wrong.error?.code).toBe('setup_link_not_valid');
  });

  it('keeps setup locked when the hash file is missing or empty', async () => {
    vi.stubEnv('SETUP_TOKEN_HASH_FILE', join(tmpdir(), 'no-such-setup-token-hash'));
    expect((await setup('check', {})).error?.code).toBe('setup_link_not_valid');
    const empty = join(await mkdtemp(join(tmpdir(), 'setup-token-')), 'empty');
    await writeFile(empty, '');
    vi.stubEnv('SETUP_TOKEN_HASH_FILE', empty);
    expect((await setup('check', {})).error?.code).toBe('setup_link_not_valid');
  });

  it('refuses a caller without the proxy secret, and every caller outside team mode', async () => {
    const { [proxy_auth_headers.secret]: _secret, ...outside } = machine;
    const body = { setup_token: setup_install.token };
    expect((await call('POST', '/v1/setup/check', outside, body)).status).toBe(401);
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect((await setup('check', {})).status).not.toBe(200);
  });

  it('stops working once the owner exists, and makes only one owner', async () => {
    const attempts = await Promise.all([setup('owner', owner), setup('owner', owner)]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 410]);
    expect((await setup('check', {})).error?.code).toBe('setup_finished');
    expect((await setup('ai-key', { api_key: anthropic_key })).status).toBe(410);
    expect(await db.select().from(user_passwords)).toHaveLength(1);
  });

  it('refuses after too many tries in a minute', async () => {
    const answers = [];
    for (let attempt = 0; attempt < 31; attempt += 1) answers.push(await setup('check', {}));
    expect(answers.at(-1)?.error?.code).toBe('rate_limited');
  });
});

describe('the AI key pasted at setup', () => {
  it('is checked with its provider and refused when the provider refuses it', async () => {
    answer_provider_checks({ 'api.anthropic.com': 401 });
    const refused = await setup('ai-key', { api_key: anthropic_key });
    expect(refused.error?.code).toBe('model_provider_key_rejected');
    const subscription = await setup('ai-key', { api_key: `sk-ant-oat01-${'x'.repeat(40)}` });
    expect(subscription.error?.code).toBe('model_key_is_claude_subscription_token');
    expect(await db.select().from(install_connections)).toEqual([]);
  });

  it('sends a key that fits several providers nowhere until the person picks one', async () => {
    const provider_check = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', provider_check);
    const shared_prefix_key = `sk-${'s'.repeat(40)}`;
    const unsure = await setup('ai-key', { api_key: shared_prefix_key });
    expect(unsure.status).toBe(409);
    expect(unsure.error?.code).toBe('model_key_fits_several_providers');
    expect(provider_check).not.toHaveBeenCalled();
    const picked = await setup('ai-key', { api_key: shared_prefix_key, provider_slot: 'openai' });
    expect(picked.data).toMatchObject({ provider_slot: 'openai' });
    expect(provider_check).toHaveBeenCalledTimes(1);
  });

  it('is stored sealed and is the default for the workspace the owner makes', async () => {
    const saved = await setup('ai-key', { api_key: anthropic_key });
    expect(saved.data).toMatchObject({ provider_slot: 'anthropic', secret_hint: 'kkkk' });
    const [row] = await db.select().from(install_connections);
    expect(JSON.stringify(row?.credentials)).not.toContain(anthropic_key);

    const { session_token } = await finish_setup();
    const person = await sign_in('session', { session_token });
    const [membership] = await db.query.workspace_members.findMany({
      where: (members, { eq }) => eq(members.user_id, person.data.user_id as string),
    });
    const model = await read_workspace_model_environment(db, membership?.workspace_id ?? '', {});
    expect(model.environment.ANTHROPIC_API_KEY).toBe(anthropic_key);
    expect(model.workspace_owned_env_names.has('ANTHROPIC_API_KEY')).toBe(true);
  });
});

describe('a ChatGPT sign-in started on the setup page', () => {
  it('opens at OpenAI and finishes only with the setup token, storing nothing when refused', async () => {
    const started = await setup('chatgpt/start', {});
    const authorize_url = new URL(started.data.authorize_url as string);
    expect(authorize_url.host).toBe('auth.openai.com');
    const state = authorize_url.searchParams.get('state');
    const other_token = randomBytes(32).toString('base64url');
    const finished = await call('POST', '/v1/setup/chatgpt/finish', machine, {
      setup_token: other_token,
      sign_in_attempt: started.data.sign_in_attempt,
      callback_url: 'http://127.0.0.1:1455/auth/callback?code=x&state=y',
    });
    expect(finished.error?.code).toBe('setup_link_not_valid');
    const replayed = await setup('chatgpt/finish', {
      sign_in_attempt: started.data.sign_in_attempt,
      callback_url: `http://127.0.0.1:1455/auth/callback?error=access_denied&state=${state}`,
    });
    expect(replayed.error?.code).toBe('chatgpt_sign_in_cancelled');
    expect(await db.select().from(install_connections)).toEqual([]);
  });
});

describe('password sign-in', () => {
  it('signs the owner in with the email and password, and refuses anything else alike', async () => {
    await finish_setup();
    const signed_in = await sign_in('password', {
      email: 'owner@example.com',
      password: owner.password,
    });
    expect(signed_in.status).toBe(201);
    expect((await sign_in('session', { session_token: signed_in.data.session_token })).status).toBe(
      200,
    );

    const wrong_password = await sign_in('password', { email: owner.email, password: 'nope' });
    const unknown_email = await sign_in('password', { email: 'x@example.com', password: 'nope' });
    expect([wrong_password.status, unknown_email.status]).toEqual([401, 401]);
    expect(wrong_password.error).toEqual(unknown_email.error);
  });

  it('resets the password with the recovery code, ends old sessions and makes a new code', async () => {
    const { session_token, recovery_code } = await finish_setup();
    const new_password = 'a new long password';
    const recovered = await sign_in('password/recover', {
      email: owner.email,
      recovery_code: recovery_code.toLowerCase(),
      new_password,
    });
    expect(recovered.status).toBe(201);
    expect(recovered.data.recovery_code).not.toBe(recovery_code);
    expect((await sign_in('session', { session_token })).status).toBe(401);
    expect(
      (await sign_in('password', { email: owner.email, password: owner.password })).status,
    ).toBe(401);
    expect((await sign_in('password', { email: owner.email, password: new_password })).status).toBe(
      201,
    );

    const reused = await sign_in('password/recover', {
      email: owner.email,
      recovery_code,
      new_password,
    });
    expect(reused.error?.code).toBe('recovery_refused');
  });

  it('refuses after ten tries for one email from one address, and the owner elsewhere still signs in', async () => {
    await finish_setup();
    const attacker = { ...machine, 'x-coworker-client-ip': '192.0.2.66' };
    const answers = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const body = { email: owner.email, password: 'wrong' };
      answers.push(await call('POST', '/v1/team-sign-in/password', attacker, body));
    }
    const from_home = { ...machine, 'x-coworker-client-ip': '198.51.100.7' };
    const owner_body = { email: owner.email, password: owner.password };
    const owner_answer = await call('POST', '/v1/team-sign-in/password', from_home, owner_body);

    expect(answers.at(-1)?.error?.code).toBe('rate_limited');
    expect(owner_answer.status).toBe(201);
  });

  it('refuses after a hundred tries for one email in a minute, spread over many addresses', async () => {
    await finish_setup();
    const answers = [];
    for (let attempt = 0; attempt < 101; attempt += 1) {
      const from_a_new_address = {
        ...machine,
        'x-coworker-client-ip': `192.0.${Math.floor(attempt / 200)}.${attempt % 200}`,
      };
      const body = { email: owner.email, password: 'wrong' };
      answers.push(await call('POST', '/v1/team-sign-in/password', from_a_new_address, body));
    }
    expect(answers.at(-1)?.error?.code).toBe('rate_limited');
  }, 60_000);

  it('says whether the owner has a password yet', async () => {
    const before = await call('GET', '/v1/team-sign-in/password/state', machine);
    await finish_setup();
    const after = await call('GET', '/v1/team-sign-in/password/state', machine);
    expect([before.data.owner_password_is_set, after.data.owner_password_is_set]).toEqual([
      false,
      true,
    ]);
  });
});

describe('the AI keys of the server in Settings', () => {
  it('lets the owner change the key, and a member only read it', async () => {
    const { session_token } = await finish_setup();
    const owner_id = (await sign_in('session', { session_token })).data.user_id as string;
    const path = '/v1/install/model-provider-accounts';
    answer_provider_checks({ 'ai-gateway.vercel.sh': 200 });
    const changed = await call('PUT', path, as_person(owner_id), {
      api_key: `vck_${'g'.repeat(40)}`,
    });
    expect(changed.data).toMatchObject({ provider_slot: 'vercel_ai_gateway', secret_hint: 'gggg' });

    const member = await invite_and_join(owner_id, 'Grace', 'member');
    const listed = await call('GET', path, as_person(member.user_id));
    expect((listed.data.accounts as unknown[]).length).toBe(2);
    const refused = await call('DELETE', `${path}/anthropic`, as_person(member.user_id));
    expect(refused.status).toBe(403);
    expect((await call('DELETE', `${path}/anthropic`, as_person(owner_id))).status).toBe(200);
  });
});

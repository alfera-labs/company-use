import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forget_attempts } from '@api/lib/attempt_limit';
import { call, machine, use_a_fresh_team_install } from '@api/routes/__tests__/team_mode_install';
import { beforeEach, expect, vi } from 'vitest';

export const anthropic_key = `sk-ant-api03-${'k'.repeat(40)}`;
export const owner = {
  email: 'Owner@Example.com',
  password: 'a long owner password',
  first_name: 'Ada',
};
export const setup_install = { token: '' };

export function answer_provider_checks(status_by_host: Record<string, number>) {
  vi.stubGlobal('fetch', async (input: Request | string | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return new Response('{}', { status: status_by_host[url.host] ?? 500 });
  });
}

/** Every test of a file that calls this starts on a new team-mode install with a setup token. */
export function use_a_fresh_install_waiting_for_setup() {
  use_a_fresh_team_install();
  beforeEach(async () => {
    forget_attempts();
    setup_install.token = randomBytes(32).toString('base64url');
    const folder = await mkdtemp(join(tmpdir(), 'setup-token-'));
    const hash_file = join(folder, 'setup_token_hash');
    const hash = createHash('sha256').update(setup_install.token).digest('hex');
    await writeFile(hash_file, `${hash}  -\n`);
    vi.stubEnv('SETUP_TOKEN_HASH_FILE', hash_file);
    answer_provider_checks({ 'api.anthropic.com': 200 });
  });
}

export const setup = (step: string, body: Record<string, unknown>) =>
  call('POST', `/v1/setup/${step}`, machine, { setup_token: setup_install.token, ...body });

export async function finish_setup(person: Record<string, unknown> = owner) {
  expect((await setup('ai-key', { api_key: anthropic_key })).status).toBe(200);
  const made = await setup('owner', person);
  expect(made.status).toBe(201);
  return made.data as { session_token: string; recovery_code: string };
}

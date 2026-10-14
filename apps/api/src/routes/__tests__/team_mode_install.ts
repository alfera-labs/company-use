import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { z } from 'zod';

const proxy_secret = 'local-development-internal-api-secret';
const json = { 'Content-Type': 'application/json' };
export const machine = { ...json, [proxy_auth_headers.secret]: proxy_secret };

type Api = { request: (path: string, init?: RequestInit) => Promise<Response> };
export let db: Database;
let api: Api;

export function as_person(user_id: string) {
  return {
    ...machine,
    [proxy_auth_headers.provider_key]: 'workos',
    [proxy_auth_headers.provider_user_id]: user_id,
    [proxy_auth_headers.organization_id]: 'org_local',
  };
}

export async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const response = await api.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
  return { status: response.status, data: payload.data ?? {}, error: payload.error };
}

export const sign_in = (path: string, body: unknown) =>
  call('POST', `/v1/team-sign-in/${path}`, machine, body);

export async function join_with(token: string) {
  const redeemed = await sign_in('link/redeem', { token });
  expect(redeemed.status).toBe(201);
  const session_token = redeemed.data.session_token as string;
  const person = await sign_in('session', { session_token });
  expect(person.status).toBe(200);
  return { session_token, user_id: person.data.user_id as string };
}

export async function sign_the_owner_in() {
  const link = await sign_in('owner-link', undefined);
  expect(link.status).toBe(201);
  return join_with(link.data.token as string);
}

export async function invite(actor_user_id: string, name: string, role: string) {
  const invited = await call('POST', '/v1/team/invitations', as_person(actor_user_id), {
    name,
    role,
  });
  const member = invited.data.member as { user_id: string } | undefined;
  const link = invited.data.sign_in_link as { token: string } | undefined;
  return { status: invited.status, user_id: member?.user_id ?? '', token: link?.token ?? '' };
}

export async function invite_and_join(actor_user_id: string, name: string, role: string) {
  const invited = await invite(actor_user_id, name, role);
  expect(invited.status).toBe(201);
  return { ...invited, ...(await join_with(invited.token)) };
}

/** Every test of a file that calls this starts on a new team-mode install with nobody in it. */
export function use_a_fresh_team_install() {
  beforeEach(async () => {
    db = await create_test_database();
    api = create_app(db) as Api;
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

const agents_answer_schema = z.object({ data: z.array(z.object({ agent_id: z.string() })).min(1) });

/** The id of the one coworker of the workspace, as this person sees it. */
export async function main_agent_id(headers: Record<string, string>): Promise<string> {
  const response = await api.request('/v1/agents', { headers });
  const [agent] = agents_answer_schema.parse(await response.json()).data;
  return agent?.agent_id ?? '';
}

const task_list_answer_schema = z.object({ data: z.array(z.object({ trigger_name: z.string() })) });

/** The names of the scheduled tasks the API lists for this person, in order. */
export async function task_names_listed_for(headers: Record<string, string>): Promise<string[]> {
  const response = await api.request('/v1/triggers', { headers });
  expect(response.status).toBe(200);
  const listed = task_list_answer_schema.parse(await response.json()).data;
  return listed.map((task) => task.trigger_name).sort();
}

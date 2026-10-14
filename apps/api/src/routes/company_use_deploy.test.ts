import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { create_app } from '@api/app';
import { forget_deploy_request_counts } from '@api/services/company_use_deploy/deploy_request_guards';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { company_use_deploy_sessions } from '@coworker/core/db/schema';
import { delete_expired_deploy_sessions_when_the_page_is_on } from '@runtime-platform/events/deploy_session_cleanup_job';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const page_origin = 'https://deploy-page.example.test';
let db: Database;
let app: ReturnType<typeof create_app>;
let caller_count = 0;

function new_caller() {
  caller_count += 1;
  return `198.51.100.${caller_count % 250}`;
}

const new_token = () => randomBytes(32).toString('base64url');
const hash_of = (token: string) => createHash('sha256').update(token).digest('hex');

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/v1/company-use/deploy/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': new_caller(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function start_install(cloud = 'digitalocean') {
  const install_id = randomUUID();
  const report_token = new_token();
  const answer = await post('start', {
    install_id,
    report_token_hash: hash_of(report_token),
    cloud,
  });
  return { install_id, report_token, answer };
}

const report_of = (install_id: string, extra: Record<string, unknown> = {}) => ({
  install_id,
  step: 'install',
  state: 'done',
  reason: null,
  address: 'https://acme-203-0-113-7.sslip.io',
  at: new Date().toISOString(),
  ...extra,
});

const send_report = (body: unknown, token?: string) =>
  post('report', body, token ? { authorization: `Bearer ${token}` } : {});

const read_status = (install_id: string, origin = page_origin) =>
  app.request(`/v1/company-use/deploy/status?install_id=${install_id}`, {
    headers: { origin, 'x-forwarded-for': new_caller() },
  });

beforeEach(async () => {
  process.env.COMPANY_USE_DEPLOY_PAGE_ORIGINS = page_origin;
  process.env.COMPANY_USE_DIGITALOCEAN_CLIENT_ID = 'test-client';
  forget_deploy_request_counts();
  db = await create_test_database();
  app = create_app(db);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.COMPANY_USE_DEPLOY_PAGE_ORIGINS;
  delete process.env.COMPANY_USE_DIGITALOCEAN_CLIENT_ID;
});

describe('starting a deploy', () => {
  it('stores only the hash, repeats safely, and refuses another token for the same id', async () => {
    const { install_id, report_token, answer } = await start_install();
    expect(answer.status).toBe(201);
    const [row] = await db
      .select()
      .from(company_use_deploy_sessions)
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    expect(row?.report_token_hash).toBe(hash_of(report_token));
    expect(JSON.stringify(row)).not.toContain(report_token);
    const repeated = await post('start', {
      install_id,
      report_token_hash: hash_of(report_token),
      cloud: 'digitalocean',
    });
    expect(repeated.status).toBe(201);
    const other = await post('start', {
      install_id,
      report_token_hash: 'a'.repeat(64),
      cloud: 'digitalocean',
    });
    expect(other.status).toBe(409);
  });

  it('gives an expired install id a fresh start', async () => {
    const { install_id, report_token } = await start_install();
    await send_report(report_of(install_id), report_token);
    await db
      .update(company_use_deploy_sessions)
      .set({ expires_time: sql`now() - interval '1 minute'` })
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    const fresh_token = new_token();
    const body = { install_id, report_token_hash: hash_of(fresh_token), cloud: 'aws' };
    expect((await post('start', body)).status).toBe(201);
    const { data } = (await (await read_status(install_id)).json()) as { data: { reports: [] } };
    expect(data.reports).toEqual([]);
    expect((await send_report(report_of(install_id), report_token)).status).toBe(401);
    expect((await send_report(report_of(install_id), fresh_token)).status).toBe(201);
  });

  it('refuses a raw token, an extra field, an unknown cloud and a body that is not JSON', async () => {
    const base = {
      install_id: randomUUID(),
      report_token_hash: 'a'.repeat(64),
      cloud: 'digitalocean',
    };
    for (const body of [{ ...base, report_token: 'x' }, { ...base, cloud: 'gcp' }, 'not json']) {
      expect((await post('start', body)).status).toBe(422);
    }
  });

  it('limits one caller to 20 starts an hour, whatever address the caller names', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const caller = {
        'x-forwarded-for': `192.0.2.${index}, 203.0.113.250`,
        'x-coworker-client-ip': `198.18.0.${index}`,
      };
      const body = { install_id: randomUUID(), report_token_hash: 'b'.repeat(64), cloud: 'aws' };
      statuses.push((await post('start', body, caller)).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('reporting progress', () => {
  it('accepts a report only with the right token', async () => {
    const { install_id, report_token } = await start_install();
    expect((await send_report(report_of(install_id))).status).toBe(401);
    expect((await send_report(report_of(install_id), new_token())).status).toBe(401);
    expect((await send_report(report_of(install_id), report_token)).status).toBe(201);
  });

  it('refuses an extra field, an unknown state and an address that is not the box', async () => {
    const { install_id, report_token } = await start_install();
    const bad_reports = [
      report_of(install_id, { logs: 'secret' }),
      report_of(install_id, { state: 'maybe' }),
      report_of(install_id, { address: 'https://evil.example.com' }),
      report_of(install_id, { address: 'https://acme-203-0-113-7.sslip.io/x' }),
    ];
    for (const body of bad_reports)
      expect((await send_report(body, report_token)).status).toBe(422);
  });

  it('keeps the latest 200 lines so the last line is never lost', async () => {
    const { install_id, report_token } = await start_install();
    for (let index = 0; index < 201; index += 1) {
      await send_report(
        report_of(install_id, { step: `step_${index}`, address: null }),
        report_token,
      );
    }
    const { data } = (await (await read_status(install_id)).json()) as {
      data: { reports: { step: string }[] };
    };
    expect(data.reports).toHaveLength(200);
    expect(data.reports.at(-1)?.step).toBe('step_200');
  });
});

describe('the life of a deploy session', () => {
  const hours_left = async (install_id: string) => {
    const [row] = await db
      .select({ expires_time: company_use_deploy_sessions.expires_time })
      .from(company_use_deploy_sessions)
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    return Math.round(((row?.expires_time.getTime() ?? 0) - Date.now()) / 3_600_000);
  };

  it('ends after an hour with no report, and lasts 7 days from the first report', async () => {
    const { install_id, report_token } = await start_install();
    expect(await hours_left(install_id)).toBe(1);
    await db
      .update(company_use_deploy_sessions)
      .set({ expires_time: sql`now() + interval '5 minutes'` })
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    const start_again = { install_id, report_token_hash: hash_of(report_token), cloud: 'aws' };
    expect((await post('start', start_again)).status).toBe(201);
    expect(await hours_left(install_id)).toBe(1);
    await send_report(report_of(install_id, { step: 'tools', state: 'started' }), report_token);
    expect(await hours_left(install_id)).toBe(7 * 24);
    expect((await post('start', start_again)).status).toBe(201);
    expect(await hours_left(install_id)).toBe(7 * 24);
    await db
      .update(company_use_deploy_sessions)
      .set({ expires_time: sql`now() + interval '2 days'` })
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    await send_report(report_of(install_id), report_token);
    expect(await hours_left(install_id)).toBe(2 * 24);
  });

  it('keeps the report budget of an install for reports with the right token', async () => {
    const { install_id, report_token } = await start_install();
    for (let attempt = 0; attempt < 301; attempt += 1) {
      expect((await send_report(report_of(install_id), new_token())).status).toBe(401);
    }
    expect((await send_report(report_of(install_id), report_token)).status).toBe(201);
  });

  it('stores only the clouds the deploy page offers', async () => {
    const row = {
      install_id: randomUUID(),
      report_token_hash: 'c'.repeat(64),
      cloud: 'gcp',
      expires_time: new Date(Date.now() + 60_000),
      created_by: 'system',
      last_updated_by: 'system',
    };
    await expect(db.insert(company_use_deploy_sessions).values(row)).rejects.toThrow();
  });
});

describe('reading the status', () => {
  it('returns the lines with no token, and allows only the deploy page origin', async () => {
    const { install_id, report_token } = await start_install();
    await send_report(report_of(install_id), report_token);
    const answer = await read_status(install_id);
    const text = await answer.text();
    expect(answer.status).toBe(200);
    expect(answer.headers.get('access-control-allow-origin')).toBe(page_origin);
    expect(text).not.toContain(hash_of(report_token));
    expect(Math.abs(JSON.parse(text).data.site_time - Date.now())).toBeLessThan(60_000);
    const other_site = await read_status(install_id, 'https://other.example.com');
    expect(other_site.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('says 404 for an unknown or expired install and 422 for a bad id', async () => {
    expect((await read_status(randomUUID())).status).toBe(404);
    expect((await read_status('nope')).status).toBe(422);
    const { install_id } = await start_install();
    await db
      .update(company_use_deploy_sessions)
      .set({ expires_time: sql`now() - interval '1 minute'` })
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    expect((await read_status(install_id)).status).toBe(404);
  });

  it('answers 404 on every deploy route when no deploy page is set up', async () => {
    delete process.env.COMPANY_USE_DEPLOY_PAGE_ORIGINS;
    expect((await read_status(randomUUID())).status).toBe(404);
    expect((await start_install()).answer.status).toBe(404);
  });
});

describe('the deploy page in a browser', () => {
  it('answers the preflight and keeps the origin header on an error answer', async () => {
    const preflight = await app.request('/v1/company-use/deploy/start', {
      method: 'OPTIONS',
      headers: {
        origin: page_origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(page_origin);
    const refused = await app.request('/v1/company-use/deploy/start', {
      method: 'POST',
      headers: { origin: page_origin, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(refused.status).toBe(422);
    expect(refused.headers.get('access-control-allow-origin')).toBe(page_origin);
  });

  it('refuses a report to an expired install', async () => {
    const { install_id, report_token } = await start_install();
    await db
      .update(company_use_deploy_sessions)
      .set({ expires_time: sql`now() - interval '1 minute'` })
      .where(eq(company_use_deploy_sessions.install_id, install_id));
    expect((await send_report(report_of(install_id), report_token)).status).toBe(401);
  });
});

describe('the DigitalOcean token route', () => {
  it('accepts only the deploy page as the return address', async () => {
    const body = {
      code: 'a'.repeat(20),
      code_verifier: 'b'.repeat(43),
      redirect_uri: 'https://evil.example.com/deploy',
    };
    const answer = await post('digitalocean/token', body);
    expect(answer.status).toBe(400);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe(
      'wrong_redirect_uri',
    );
  });
});

describe('the DigitalOcean calls', () => {
  const deploy_page = `${page_origin}/deploy`;

  it('trades a code for a token with a form body and the client id from the env', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return Response.json({ access_token: 'do-token-123456', token_type: 'bearer' });
    });
    const body = { code: 'a'.repeat(20), code_verifier: 'b'.repeat(43), redirect_uri: deploy_page };
    const answer = await post('digitalocean/token', body);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ data: { access_token: 'do-token-123456' } });
    expect(calls[0]?.url).toBe('https://cloud.digitalocean.com/v1/oauth/token');
    expect(new URLSearchParams(calls[0]?.body).get('client_id')).toBe('test-client');
    expect(new URLSearchParams(calls[0]?.body).get('code_verifier')).toBe('b'.repeat(43));
  });

  it('takes the deploy page of the app and the client id that page signed in with', async () => {
    const forms: URLSearchParams[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      forms.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: 'do-token-123456', token_type: 'bearer' });
    });
    const body = {
      client_id: 'app-page-client',
      code: 'a'.repeat(20),
      code_verifier: 'b'.repeat(43),
      redirect_uri: deploy_page,
    };
    expect((await post('digitalocean/token', body)).status).toBe(200);
    expect(forms[0]?.get('client_id')).toBe('app-page-client');
    expect(forms[0]?.get('redirect_uri')).toBe(deploy_page);
    const other_path = { ...body, redirect_uri: `${page_origin}/company-use/deploy` };
    expect((await post('digitalocean/token', other_path)).status).toBe(400);
  });

  it('says 502 when DigitalOcean refuses the code, and 503 with no client id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'invalid_request' }, { status: 401 }),
    );
    const body = { code: 'a'.repeat(20), code_verifier: 'b'.repeat(43), redirect_uri: deploy_page };
    expect((await post('digitalocean/token', body)).status).toBe(502);
    delete process.env.COMPANY_USE_DIGITALOCEAN_CLIENT_ID;
    expect((await post('digitalocean/token', body)).status).toBe(503);
  });

  it('gives a token back to DigitalOcean', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 200 });
    });
    const answer = await post('digitalocean/revoke', { token: 'do-token-123456' });
    expect(answer.status).toBe(200);
    expect(calls).toEqual(['https://cloud.digitalocean.com/v1/oauth/revoke?token=do-token-123456']);
  });
});

describe('the cleanup', () => {
  it('deletes expired sessions and keeps live ones', async () => {
    const live = await start_install();
    const old = await start_install('aws');
    await db
      .update(company_use_deploy_sessions)
      .set({ expires_time: sql`now() - interval '1 minute'` })
      .where(eq(company_use_deploy_sessions.install_id, old.install_id));
    const result = await delete_expired_deploy_sessions_when_the_page_is_on(db);
    expect(result).toEqual({ deleted_count: 1 });
    const left = await db
      .select({ install_id: company_use_deploy_sessions.install_id })
      .from(company_use_deploy_sessions);
    expect(left.map((row) => row.install_id)).toEqual([live.install_id]);
  });
});

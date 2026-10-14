import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticate_request,
  is_local_mode_on,
  is_request_from_this_machine,
  local_organization_id,
  local_session,
  refuse_request_in_local_mode,
} from '@/lib/local_mode';

function request_for(
  host: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) {
  return new Request(`http://${host}/chats`, {
    method: init.method ?? 'GET',
    headers: { host, ...init.headers },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('with the switch unset', () => {
  it('is off unless the switch says local', () => {
    expect(is_local_mode_on()).toBe(false);
    vi.stubEnv('COWORKER_AUTH_MODE', 'workos');
    expect(is_local_mode_on()).toBe(false);
    vi.stubEnv('COWORKER_AUTH_MODE', 'local');
    expect(is_local_mode_on()).toBe(true);
  });

  it('refuses nothing, so a domain, a proxy and a cross-site write reach the usual checks', () => {
    const through_a_proxy = request_for('app.example.com', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9', 'sec-fetch-site': 'cross-site' },
    });
    expect(refuse_request_in_local_mode(through_a_proxy)).toBeNull();
  });

  it('signs nobody in without a session cookie', async () => {
    const { auth } = await authenticate_request(request_for('localhost:3000'));
    expect(auth.user).toBeNull();
  });
});

describe('local mode', () => {
  function turn_local_mode_on() {
    vi.stubEnv('COWORKER_AUTH_MODE', 'local');
  }

  it('serves a browser that reaches this machine by a loopback name', () => {
    turn_local_mode_on();
    const loopback_names = [
      'localhost:3000',
      '127.0.0.1:3000',
      '[::1]:3000',
      'app.localhost:3000',
      'LOCALHOST:3000',
      'App.Localhost:3000',
    ];
    for (const host of loopback_names) {
      expect(is_request_from_this_machine(request_for(host))).toBe(true);
      expect(refuse_request_in_local_mode(request_for(host))).toBeNull();
    }
  });

  it('refuses any other name, so a LAN address or a rebinding page gets nothing', async () => {
    turn_local_mode_on();
    for (const host of ['192.168.1.20:3000', 'alfera.example.com', 'localhost.attacker.example']) {
      const refusal = refuse_request_in_local_mode(request_for(host));
      expect(refusal?.status).toBe(403);
      expect(await refusal?.text()).toContain('local mode');
    }
  });

  it('refuses a request that came through a proxy', () => {
    turn_local_mode_on();
    for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip']) {
      const request = request_for('localhost:3000', { headers: { [header]: '203.0.113.9' } });
      expect(refuse_request_in_local_mode(request)?.status).toBe(403);
    }
  });

  it('refuses a write from another site and allows one from its own page', () => {
    turn_local_mode_on();
    const from_other_site = request_for('localhost:3000', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://attacker.example' },
    });
    const with_no_origin_proof = request_for('localhost:3000', { method: 'POST' });
    const from_own_page = request_for('localhost:3000', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
    });

    expect(refuse_request_in_local_mode(from_other_site)?.status).toBe(403);
    expect(refuse_request_in_local_mode(with_no_origin_proof)?.status).toBe(403);
    expect(refuse_request_in_local_mode(from_own_page)).toBeNull();
  });

  it('signs the one local person in with a fixed identity and no email', async () => {
    turn_local_mode_on();
    vi.stubEnv('COWORKER_LOCAL_USER_NAME', ' Ada ');
    const { auth } = await authenticate_request(request_for('localhost:3000'));

    expect(auth).toEqual(local_session().auth);
    expect(auth.organizationId).toBe(local_organization_id);
    expect(auth.user?.id).toBe('user_local');
    expect(auth.user?.firstName).toBe('Ada');
    expect(auth.user?.email).toBe('');
  });
});

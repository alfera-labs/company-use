import {
  is_local_mode_switched_on,
  is_team_mode_switched_on,
  read_team_address,
  read_team_mode_conflict,
} from '@coworker/config/local_mode_switch';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the team mode switch', () => {
  it('is on for the exact value team and for nothing else', () => {
    for (const value of ['', 'local', 'workos', 'Team', 'TEAM', ' team', 'team ', 'true', '1']) {
      vi.stubEnv('COWORKER_AUTH_MODE', value);
      expect(is_team_mode_switched_on()).toBe(false);
    }
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    expect(is_team_mode_switched_on()).toBe(true);
    expect(is_local_mode_switched_on()).toBe(false);
  });

  it('names no conflict for a hosted install, whatever provider keys it holds', () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    vi.stubEnv('WORKOS_API_KEY', 'a_provider_key');
    vi.stubEnv('WORKOS_CLIENT_ID', 'a_client_id');
    expect(read_team_mode_conflict()).toBeNull();
  });

  it('names the provider keys that are set beside team mode', () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    vi.stubEnv('WORKOS_API_KEY', '');
    vi.stubEnv('WORKOS_CLIENT_ID', ' ');
    expect(read_team_mode_conflict()).toBeNull();
    vi.stubEnv('WORKOS_CLIENT_ID', 'a_client_id');
    expect(read_team_mode_conflict()).toContain('WORKOS_CLIENT_ID is set');
    vi.stubEnv('WORKOS_API_KEY', 'a_provider_key');
    expect(read_team_mode_conflict()).toContain('WORKOS_API_KEY and WORKOS_CLIENT_ID is set');
  });

  it('reads the address people open and who can open the install there', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_BIND', '');
    expect(read_team_address()).toEqual({
      address: 'http://localhost:3000',
      who_can_open: 'this_machine_only',
    });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://192.168.1.20:3000/');
    vi.stubEnv('APP_BIND', '0.0.0.0');
    expect(read_team_address()).toEqual({
      address: 'http://192.168.1.20:3000',
      who_can_open: 'other_machines',
    });
    vi.stubEnv('APP_BIND', '127.0.0.1');
    expect(read_team_address().who_can_open).toBe('through_a_proxy_on_this_machine');
  });

  it('gives the address as a browser writes it, whatever way it was typed', () => {
    vi.stubEnv('APP_BIND', '0.0.0.0');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://Office-Mac.local.:3370/');
    expect(read_team_address()).toEqual({
      address: 'http://office-mac.local:3370',
      who_can_open: 'other_machines',
    });
  });

  it('calls an address of this machine "this machine only", also when the port is open', () => {
    const hosts_of_this_machine_only = [
      'localhost',
      '127.0.0.1',
      '127.8.9.1',
      '[::1]',
      'app.localhost',
      '0.0.0.0',
      'host.docker.internal',
      'LOCALHOST',
    ];
    for (const port_bind of ['127.0.0.1', '0.0.0.0']) {
      vi.stubEnv('APP_BIND', port_bind);
      for (const host of hosts_of_this_machine_only) {
        vi.stubEnv('NEXT_PUBLIC_APP_URL', `http://${host}:3000`);
        expect(read_team_address().who_can_open, `${host} on ${port_bind}`).toBe(
          'this_machine_only',
        );
      }
    }
  });

  it('does not take a name that only starts like an address of this machine for one', () => {
    vi.stubEnv('APP_BIND', '0.0.0.0');
    for (const host of ['192.168.1.20', '127.example.lan', 'localhost.example.com']) {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', `http://${host}:3000`);
      expect(read_team_address().who_can_open, host).toBe('other_machines');
    }
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://alfera.example.com');
    vi.stubEnv('APP_BIND', '127.0.0.1');
    expect(read_team_address().who_can_open).toBe('through_a_proxy_on_this_machine');
  });
});

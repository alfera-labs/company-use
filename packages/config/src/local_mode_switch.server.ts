import { normalize_origin } from '@coworker/config/env_value_schemas';

/** Local mode serves one person on one machine with no sign-in. Only COWORKER_AUTH_MODE=local turns it on. */
export function is_local_mode_switched_on(): boolean {
  return process.env.COWORKER_AUTH_MODE === 'local';
}

/** The first name local mode greets the person with, or null when none is set. */
export function read_local_user_name(): string | null {
  return process.env.COWORKER_LOCAL_USER_NAME?.trim() || null;
}

/**
 * Who the one local person is to the API. Team mode keeps this person as the first owner and
 * keeps the one workspace, so turning it on orphans no chat.
 */
export const local_mode_identity = {
  provider_key: 'workos',
  provider_user_id: 'user_local',
  organization_id: 'org_local',
} as const;

/** True when the process carries the marks the test runner puts on its own processes. */
export function has_test_runner_marks(): boolean {
  return process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID !== undefined;
}

/** Team mode signs people in with one-time links this install makes itself. Only COWORKER_AUTH_MODE=team turns it on. */
export function is_team_mode_switched_on(): boolean {
  return process.env.COWORKER_AUTH_MODE === 'team';
}

const sign_in_provider_key_names = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID'];

/**
 * Why this install must not run in team mode, or null when it may. Team mode and a sign-in
 * provider are two answers to "who is this person", and an install with both would let one
 * path sign a person in while the other decides what they may do.
 */
export function read_team_mode_conflict(): string | null {
  if (!is_team_mode_switched_on()) return null;
  const provider_keys = sign_in_provider_key_names.filter((name) => process.env[name]?.trim());
  if (provider_keys.length === 0) return null;
  return `COWORKER_AUTH_MODE=team runs its own sign-in, but ${provider_keys.join(' and ')} is set. Remove the sign-in provider keys, or unset COWORKER_AUTH_MODE.`;
}

export type WhoCanOpenTheInstall =
  | 'this_machine_only'
  | 'other_machines'
  | 'through_a_proxy_on_this_machine';

/**
 * Where people open a team-mode install, and who can open it there. Both come from two lines
 * of the install's .env, which `./alfera add team` writes: the address people are given and
 * where the dashboard port is published. The helper reads the same two lines by the same rule
 * (`who_can_open_this_install` in deploy/alfera), so its status and doctor and the Team page
 * say one thing. A sign-in link is made for this address, whatever address the page that asks
 * for it is open at.
 */
export function read_team_address(): { address: string; who_can_open: WhoCanOpenTheInstall } {
  const address = normalize_origin(
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000',
  );
  return { address, who_can_open: read_who_can_open(address) };
}

function read_who_can_open(address: string): WhoCanOpenTheInstall {
  if (is_an_address_of_this_machine_only(address)) return 'this_machine_only';
  return is_app_port_open_to_other_machines()
    ? 'other_machines'
    : 'through_a_proxy_on_this_machine';
}

/**
 * True when the dashboard port is published to other machines (APP_BIND of the install's .env).
 * Then a request can reach the dashboard with no proxy in front, so a header that a proxy
 * would set can come from anyone.
 */
export function is_app_port_open_to_other_machines(): boolean {
  const port_bind = process.env.APP_BIND?.trim() || '127.0.0.1';
  return !/^(127\.|localhost$|::1$|\[::1\]$)/.test(port_bind);
}

const names_of_this_machine_only = ['localhost', '[::1]', '0.0.0.0', 'host.docker.internal'];

function is_an_address_of_this_machine_only(address: string): boolean {
  if (!URL.canParse(address)) return false;
  const host = new URL(address).hostname.toLowerCase().replace(/\.$/, '');
  return (
    names_of_this_machine_only.includes(host) ||
    host.endsWith('.localhost') ||
    /^127\.\d/.test(host)
  );
}

export function read_setup_token_hash_file_path(): string | null {
  return process.env.SETUP_TOKEN_HASH_FILE?.trim() || null;
}

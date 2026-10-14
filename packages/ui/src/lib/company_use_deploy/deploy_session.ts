import { post_to_deploy_api } from '@coworker/ui/lib/company_use_deploy/deploy_api';
import {
  install_id_schema,
  token_schema,
} from '@coworker/ui/lib/company_use_deploy/deploy_schemas';
import { cloud_names } from '@coworker/ui/lib/company_use_deploy/deploy_words';
import { z } from 'zod';

const storage_key = 'alfera_company_use_deploy';
const server_storage_key = 'alfera_company_use_deploy_server';
const hour_ms = 60 * 60 * 1000;
export const secrets_kept_before_the_first_report_ms = hour_ms;
export const secrets_kept_after_the_first_report_ms = 7 * 24 * hour_ms;

export const test_overrides_schema = z.strictObject({
  registry_user: z.string().max(200).optional(),
  registry_token: z.string().max(500).optional(),
  source_archive_url: z.url().optional(),
  install_files_url: z.url().optional(),
  first_boot_url: z.string().max(20_000).optional(),
});
export type TestOverrides = z.infer<typeof test_overrides_schema>;

const deploy_session_schema = z.strictObject({
  install_id: install_id_schema,
  setup_token: token_schema,
  report_token: token_schema,
  name: z.string().regex(/^[a-z0-9]{0,20}$/),
  cloud: z.enum(cloud_names),
  backups: z.boolean(),
  version: z.string().min(1).max(100),
  api_origin: z.url(),
  started_at: z.number(),
  phase: z.enum(['leaving_for_digitalocean', 'creating', 'open_aws', 'making', 'opened']),
  droplet_id: z.number().nullable(),
  sign_in: z.strictObject({ state: z.string(), verifier: z.string() }).nullable(),
  replaces_install_id: install_id_schema.nullable(),
  server_address: z.string().nullable(),
  opened_at: z.number().nullable(),
  test_overrides: test_overrides_schema.nullable(),
  secrets_expire_at: z.number(),
});
export type DeploySession = z.infer<typeof deploy_session_schema>;

const server_without_its_link_schema = deploy_session_schema.pick({
  install_id: true,
  cloud: true,
  name: true,
  backups: true,
  phase: true,
  opened_at: true,
});
export type ServerWithoutItsLink = z.infer<typeof server_without_its_link_schema>;

export type DeployChoices = Pick<DeploySession, 'cloud' | 'name' | 'backups'>;

const to_base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

export const random_token = (byte_count = 32) =>
  to_base64url(crypto.getRandomValues(new Uint8Array(byte_count)));

async function sha256_bytes(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export const sha256_hex = async (text: string) =>
  Array.from(await sha256_bytes(text), (byte) => byte.toString(16).padStart(2, '0')).join('');

export const sha256_base64url = async (text: string) => to_base64url(await sha256_bytes(text));

export type SessionSettings = {
  version: string;
  api_origin: string;
  test_overrides: TestOverrides | null;
};

export function create_session(choices: DeployChoices, settings: SessionSettings): DeploySession {
  return {
    ...choices,
    ...settings,
    install_id: crypto.randomUUID(),
    setup_token: random_token(),
    report_token: random_token(),
    started_at: Date.now(),
    phase: choices.cloud === 'aws' ? 'open_aws' : 'leaving_for_digitalocean',
    droplet_id: null,
    sign_in: null,
    replaces_install_id: null,
    server_address: null,
    opened_at: null,
    secrets_expire_at: Date.now() + secrets_kept_before_the_first_report_ms,
  };
}

export const with_secrets_kept_for_an_hour = (session: DeploySession): DeploySession => ({
  ...session,
  secrets_expire_at: Date.now() + secrets_kept_before_the_first_report_ms,
});

function save_server_without_its_link(session: DeploySession) {
  const { install_id, cloud, name, backups, phase, opened_at } = session;
  const server = { install_id, cloud, name, backups, phase, opened_at };
  localStorage.setItem(server_storage_key, JSON.stringify(server));
}

export function save_session(session: DeploySession) {
  localStorage.setItem(storage_key, JSON.stringify(session));
  save_server_without_its_link(session);
}

export function forget_the_secrets_as_setup_opens(opened: DeploySession) {
  save_server_without_its_link(opened);
  localStorage.removeItem(storage_key);
}

export function keep_the_secrets_after_the_first_report(install_id: string) {
  const stored = read_session();
  const kept_until = Date.now() + secrets_kept_after_the_first_report_ms;
  if (!stored || stored.install_id !== install_id) return;
  if (stored.secrets_expire_at - Date.now() > secrets_kept_before_the_first_report_ms) return;
  save_session({ ...stored, secrets_expire_at: kept_until });
}

function parse_stored_text(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn('[company-use-deploy] the saved server is not readable', error);
    return null;
  }
}

export function read_session(): DeploySession | null {
  const stored = localStorage.getItem(storage_key);
  if (!stored) return null;
  const parsed = deploy_session_schema.safeParse(parse_stored_text(stored));
  if (parsed.success && parsed.data.secrets_expire_at > Date.now()) return parsed.data;
  localStorage.removeItem(storage_key);
  return null;
}

export function read_server_without_its_link(): ServerWithoutItsLink | null {
  const stored = localStorage.getItem(server_storage_key);
  if (!stored) return null;
  const parsed = server_without_its_link_schema.safeParse(parse_stored_text(stored));
  return parsed.success ? parsed.data : null;
}

export function forget_session() {
  localStorage.removeItem(storage_key);
  localStorage.removeItem(server_storage_key);
}

export async function register_session(session: DeploySession) {
  const answer = await post_to_deploy_api(session.api_origin, 'start', {
    install_id: session.install_id,
    report_token_hash: await sha256_hex(session.report_token),
    cloud: session.cloud,
  });
  return answer.ok;
}

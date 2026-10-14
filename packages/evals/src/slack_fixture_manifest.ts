import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const repository_root = path.resolve(import.meta.dirname, '../../..');

export type SlackEvalFixture = {
  task_id: string;
  account_email: string;
  slack_actor_email: string;
  product_identity_key: string;
  slack_workspace_name: string;
  status: 'planned' | 'product_ready' | 'slack_created' | 'oauth_pending' | 'ready' | 'failed';
  product_user_id?: string | undefined;
  product_workspace_id?: string | undefined;
  slack_team_id?: string | undefined;
  slack_channel_id?: string | undefined;
  slack_workspace_url?: string | undefined;
};

export type SlackEvalFixtureManifest = {
  schema_version: 1;
  suite_name: string;
  base_email: string;
  gmail_password_env: 'SLACK_EVAL_ACTOR_PASSWORD';
  fixtures: SlackEvalFixture[];
};

const email_schema = z.string().trim().toLowerCase().email();
const fixture_schema = z
  .object({
    task_id: z.string().trim().min(1),
    account_email: email_schema,
    slack_actor_email: email_schema.optional(),
    product_identity_key: z.string().trim().min(1),
    slack_workspace_name: z.string().trim().min(1),
    status: z.enum([
      'planned',
      'product_ready',
      'workspace_created',
      'slack_created',
      'oauth_pending',
      'ready',
      'failed',
    ]),
    product_user_id: z.string().trim().min(1).optional(),
    product_workspace_id: z.string().trim().min(1).optional(),
    slack_team_id: z.string().trim().min(1).optional(),
    slack_channel_id: z.string().trim().min(1).optional(),
    slack_workspace_url: z.string().trim().min(1).optional(),
  })
  .transform((fixture) => ({
    ...fixture,
    status: fixture.status === 'workspace_created' ? ('product_ready' as const) : fixture.status,
  }));
const fixture_manifest_schema = z
  .object({
    schema_version: z.literal(1),
    suite_name: z.string().trim().min(1),
    base_email: email_schema,
    gmail_password_env: z.literal('SLACK_EVAL_ACTOR_PASSWORD'),
    fixtures: z.array(fixture_schema),
  })
  .transform((manifest) => ({
    ...manifest,
    fixtures: manifest.fixtures.map((fixture) => ({
      ...fixture,
      slack_actor_email: fixture.slack_actor_email ?? manifest.base_email,
    })),
  }));

export async function load_slack_fixture_manifest(pathname: string) {
  return parse_slack_fixture_manifest(
    parse(await readFile(resolve_slack_fixture_manifest_path(pathname), 'utf8')),
  );
}

export function resolve_slack_fixture_manifest_path(pathname: string) {
  return path.isAbsolute(pathname) ? pathname : path.resolve(repository_root, pathname);
}

export function create_slack_fixture_manifest(
  suite_name: string,
  task_ids: string[],
  base_email: string,
): SlackEvalFixtureManifest {
  const fixtures = task_ids.map((task_id, index) => ({
    task_id,
    account_email: add_email_alias(base_email, index + 1),
    slack_actor_email: normalize_email(base_email),
    product_identity_key: `${suite_name}:${task_id}`,
    slack_workspace_name: `Alfera Eval ${String(index + 1).padStart(3, '0')} ${task_id}`,
    status: 'planned' as const,
  }));
  return {
    schema_version: 1,
    suite_name,
    base_email: normalize_email(base_email),
    gmail_password_env: 'SLACK_EVAL_ACTOR_PASSWORD',
    fixtures,
  };
}

export function parse_slack_fixture_manifest(value: unknown): SlackEvalFixtureManifest {
  const manifest = fixture_manifest_schema.parse(value);
  validate_unique_fields(manifest.fixtures);
  return manifest;
}

export function ready_fixture_by_task(manifest: SlackEvalFixtureManifest, task_ids?: string[]) {
  const selected = task_ids
    ? task_ids.map((task_id) => {
        const fixture = manifest.fixtures.find((item) => item.task_id === task_id);
        if (!fixture) throw new Error(`${task_id} fixture is missing`);
        return fixture;
      })
    : manifest.fixtures;
  const entries = selected.map((fixture) => {
    if (fixture.status !== 'ready') throw new Error(`${fixture.task_id} fixture is not ready`);
    if (
      !fixture.product_user_id ||
      !fixture.product_workspace_id ||
      !fixture.slack_team_id ||
      !fixture.slack_channel_id
    ) {
      throw new Error(`${fixture.task_id} fixture is missing runtime identifiers`);
    }
    return [fixture.task_id, fixture] as const;
  });
  return new Map(entries);
}

function add_email_alias(email: string, index: number) {
  const normalized = normalize_email(email);
  const [local, domain] = normalized.split('@');
  if (!local || !domain) throw new Error('base_email must be a valid email');
  return `${local.split('+')[0]}+${index}@${domain}`;
}

function validate_unique_fields(fixtures: SlackEvalFixture[]) {
  for (const field of [
    'task_id',
    'account_email',
    'product_user_id',
    'product_workspace_id',
    'slack_team_id',
  ] as const) {
    const values = fixtures.map((fixture) => fixture[field]).filter(Boolean);
    if (new Set(values).size !== values.length)
      throw new Error(`fixture ${field} values must be unique`);
  }
}

function normalize_email(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/u.test(email)) throw new Error('email must be valid');
  return email;
}

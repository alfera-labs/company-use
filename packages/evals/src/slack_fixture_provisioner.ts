import type { Database } from '@coworker/core';
import { connections } from '@coworker/core';
import {
  provision_workspace_for_identity,
  rename_workspace,
} from '@coworker/core/db/queries/workspace_provisioning';
import { map_with_concurrency } from '@coworker/evals/bounded_map';
import type {
  SlackEvalFixture,
  SlackEvalFixtureManifest,
} from '@coworker/evals/slack_fixture_manifest';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

const eval_fixture_provider = 'eval_fixture';
const fixture_provisioning_concurrency = 8;

export async function provision_product_fixtures(
  db: Database,
  manifest: SlackEvalFixtureManifest,
  source_workspace_id: string,
) {
  const source_connections = await list_reusable_connections(db, source_workspace_id);
  const fixtures: SlackEvalFixture[] = await map_with_concurrency(
    manifest.fixtures,
    fixture_provisioning_concurrency,
    async (fixture) => {
      const identity = await provision_workspace_for_identity(db, {
        provider_key: eval_fixture_provider,
        provider_user_id: fixture.product_identity_key,
        organization_id: fixture.product_identity_key,
        membership_id: fixture.product_identity_key,
        email: fixture.account_email,
        first_name: 'Robin',
        last_name: 'Vale',
        workspace_data: {
          eval_fixture: { suite_name: manifest.suite_name, task_id: fixture.task_id },
        },
        user_data: {
          eval_fixture: { suite_name: manifest.suite_name, task_id: fixture.task_id },
        },
      });
      await rename_workspace(db, {
        workspace_id: identity.workspace_id,
        workspace_name: fixture.slack_workspace_name,
        actor_id: identity.user_id,
      });
      await clone_connections(db, source_connections, identity);
      const provisioned_fixture: SlackEvalFixture = {
        ...fixture,
        product_user_id: identity.user_id,
        product_workspace_id: identity.workspace_id,
        status: fixture.status === 'planned' ? 'product_ready' : fixture.status,
      };
      return provisioned_fixture;
    },
  );
  return { ...manifest, fixtures } satisfies SlackEvalFixtureManifest;
}

async function list_reusable_connections(db: Database, workspace_id: string) {
  return db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        eq(connections.provider_key, 'composio'),
        eq(connections.connection_status, 'active'),
        eq(connections.health_status, 'healthy'),
        sql`coalesce(${connections.connection_config}->>'connection_access_type', 'shared') = 'shared'`,
      ),
    );
}

async function clone_connections(
  db: Database,
  source_connections: Awaited<ReturnType<typeof list_reusable_connections>>,
  identity: { user_id: string; workspace_id: string },
) {
  await Promise.all(source_connections.map((source) => clone_connection(db, source, identity)));
}

async function clone_connection(
  db: Database,
  source: Awaited<ReturnType<typeof list_reusable_connections>>[number],
  identity: { user_id: string; workspace_id: string },
) {
  const existing = await find_cloned_connection(db, identity.workspace_id, source.connection_id);
  if (existing) return existing;
  const connection_id = create_id(id_prefixes.connection);
  const connection_key = `${source.provider_key}:${source.connection_profile_key}:eval-fixture:${source.connection_id}`;
  const [connection] = await db
    .insert(connections)
    .values({
      connection_id,
      workspace_id: identity.workspace_id,
      app_id: source.app_id,
      connection_key,
      connection_name: source.connection_name,
      connection_status: 'active',
      provider_key: source.provider_key,
      provider_config_key: source.provider_config_key,
      provider_config_version: source.provider_config_version,
      connection_profile_key: source.connection_profile_key,
      connection_profile_version: source.connection_profile_version,
      auth_method_key: source.auth_method_key,
      external_user_key: source.external_user_key,
      credentials: source.credentials,
      credential_expiry_time: source.credential_expiry_time,
      external_account_id: source.external_account_id,
      external_account_name: source.external_account_name,
      authorized_scopes: source.authorized_scopes,
      health_status: source.health_status,
      connected_by: identity.user_id,
      connected_time: source.connected_time,
      last_checked_time: source.last_checked_time,
      last_provider_update_time: source.last_provider_update_time,
      connection_config: source.connection_config,
      setup_state: {},
      provider_account: source.provider_account,
      metadata: {
        ...source.metadata,
        eval_fixture_source_connection_id: source.connection_id,
        eval_fixture_source_workspace_id: source.workspace_id,
      },
      created_by: identity.user_id,
      last_updated_by: identity.user_id,
    })
    .onConflictDoNothing({
      target: [connections.workspace_id, connections.connection_key],
    })
    .returning({ connection_id: connections.connection_id });
  if (connection) return connection;
  const concurrent_connection = await find_cloned_connection(
    db,
    identity.workspace_id,
    source.connection_id,
  );
  if (!concurrent_connection) throw new Error('Cloned connection insert did not return a row');
  return concurrent_connection;
}

async function find_cloned_connection(
  db: Database,
  workspace_id: string,
  source_connection_id: string,
) {
  const [connection] = await db
    .select({ connection_id: connections.connection_id })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        sql`${connections.metadata}->>'eval_fixture_source_connection_id' = ${source_connection_id}`,
      ),
    )
    .limit(1);
  return connection ?? null;
}

export function fixture_for_task(manifest: SlackEvalFixtureManifest, task_id: string) {
  const fixture = manifest.fixtures.find((item) => item.task_id === task_id);
  if (!fixture) throw new Error(`${task_id} fixture is missing`);
  return fixture as SlackEvalFixture;
}

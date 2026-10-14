import { seed_connector_catalog } from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { expect, it } from 'vitest';

it('leaves an app another seed owns untouched, and still seeds the rest', async () => {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await seed_connector_catalog(db);

  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  const [profile] = slack_app?.metadata.provider_configs?.[0]?.connection_profiles ?? [];
  expect(profile?.connection_profile_key).toBe('native:slack:oauth_bot');

  const slack_list_channels = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-list_channels-1'),
  });
  expect(slack_list_channels?.runtime_handler).toBe('slack.list_channels');

  const gmail_list_messages = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'gmail-list_messages-1'),
  });
  expect(gmail_list_messages?.runtime_handler).toBe('connectors.gmail-list_messages-1');
});

it('seeds the connector apps when nothing else claimed them', async () => {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  await seed_connector_catalog(db);

  const seeded = await db.query.apps.findMany({
    where: (table, { eq }) => eq(table.app_category, 'connectors'),
  });
  expect(seeded.map((app) => app.app_name).sort()).toEqual([
    'attio',
    'github',
    'gmail',
    'google_drive',
    'granola',
    'hubspot',
    'notion',
    'salesforce',
    'slack',
  ]);
});

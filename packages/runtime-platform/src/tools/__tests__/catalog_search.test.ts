import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { search_tool_catalog } from '@coworker/core/db/queries/catalog';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { expect, it } from 'vitest';

it('ranks the requested operation before other tools in a selected app', async () => {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);

  const tools = await search_tool_catalog(db, {
    workspace_id,
    app_name: 'slack',
    query: 'slack read history',
    limit: 50,
  });

  expect(tools[0]?.node_key).toBe('slack-read_history-1');
});

it('uses equivalent read terms to find an existing named tool', async () => {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);

  const tools = await search_tool_catalog(db, {
    workspace_id,
    app_name: 'slack',
    query: 'search history',
    limit: 50,
  });

  expect(tools[0]?.node_key).toBe('slack-read_history-1');
});

it('filters by the requested operation inside a selected app', async () => {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);

  const tools = await search_tool_catalog(db, {
    workspace_id,
    app_name: 'slack',
    query: 'operation-that-does-not-exist',
    limit: 50,
  });

  expect(tools).toEqual([]);
});

it('paginates app-scoped catalog search without repeating the first match', async () => {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);

  const first_page = await search_tool_catalog(db, {
    workspace_id,
    app_name: 'slack',
    query: 'slack read history',
    limit: 1,
  });
  const second_page = await search_tool_catalog(db, {
    workspace_id,
    app_name: 'slack',
    query: 'slack read history',
    limit: 1,
    offset: 1,
  });

  expect(first_page.map((tool) => tool.node_key)).toEqual(['slack-read_history-1']);
  expect(second_page).toHaveLength(1);
  expect(second_page[0]?.node_key).not.toBe(first_page[0]?.node_key);
});

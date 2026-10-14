import { vi } from 'vitest';

const schema_fault = vi.hoisted(() => ({ mode: 'none' as 'none' | 'fails' | 'throws', calls: 0 }));

vi.mock('@runtime-platform/tools/tool_schema', async (import_original) => {
  const original = await import_original<typeof import('@runtime-platform/tools/tool_schema')>();
  return {
    ...original,
    get_tool_schema: async (...args: Parameters<typeof original.get_tool_schema>) => {
      schema_fault.calls += 1;
      if (schema_fault.mode === 'throws') throw new Error('schema store unavailable');
      if (schema_fault.mode === 'fails') {
        return { success: false, error: { code: 'tool_not_found', message: 'gone' } };
      }
      return original.get_tool_schema(...args);
    },
  };
});

import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { apps, nodes } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { runtime_search_tools_tool } from '@runtime-platform/tools/definitions/runtime_search_tools';
import { get_tool_schema } from '@runtime-platform/tools/tool_schema';
import { beforeEach, describe, expect, it } from 'vitest';

type SearchData = {
  execution_protocol: Record<string, unknown>;
  result_count: number;
  tools: Array<Record<string, unknown> & { node_key: string }>;
  has_more: boolean;
};

const app_name = 'zebra_ledger';

describe('catalog search inlines the top tool schema', () => {
  beforeEach(() => {
    schema_fault.mode = 'none';
    schema_fault.calls = 0;
  });

  it('inlines the exact get_tool_schema data for a single strong hit', async () => {
    const fixture = await create_fixture();
    await insert_tool(fixture, { node_name: 'export_rows' });

    const data = await search(fixture, 'export rows');
    const schema = await get_tool_schema(fixture.db, {
      ...fixture.schema_context,
      node_key: `${app_name}-export_rows-1`,
    });

    expect(data.result_count).toBe(1);
    expect(data.execution_protocol).toMatchObject({
      node_keys_are_callable: false,
      schema_inlined_for: `${app_name}-export_rows-1`,
    });
    expect(schema.success).toBe(true);
    if (!schema.success) throw new Error('Expected get_tool_schema to succeed');
    expect(data.tools[0]?.schema).toEqual(schema.data);
  });

  it('lets the schema ride above the 3,400 summary cap while the result stays under 12,000', async () => {
    const fixture = await create_fixture();
    await insert_tool(fixture, { node_name: 'export_rows', field_description_length: 5_000 });

    const data = await search(fixture, 'export rows');

    expect(data.tools[0]?.schema).toBeDefined();
    expect(JSON.stringify(data).length).toBeGreaterThan(3_400);
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(12_000);
  });

  it('does not inline when more than three tools are visible', async () => {
    const fixture = await create_fixture();
    for (const node_name of ['export_rows', 'export_sheets', 'export_totals', 'export_notes']) {
      await insert_tool(fixture, { node_name });
    }

    const data = await search(fixture, 'export');

    expect(data.result_count).toBe(4);
    expect(data.tools.some((tool) => 'schema' in tool)).toBe(false);
    expect(data.execution_protocol).not.toHaveProperty('schema_inlined_for');
    expect(schema_fault.calls).toBe(0);
  });

  it('drops the schema, never a summary, when the result would pass 12,000 chars', async () => {
    const fixture = await create_fixture();
    await insert_tool(fixture, { node_name: 'export_rows', field_description_length: 13_000 });

    const data = await search(fixture, 'export rows');

    expect(data.result_count).toBe(1);
    expect(data.tools[0]?.node_key).toBe(`${app_name}-export_rows-1`);
    expect(data.tools[0]).not.toHaveProperty('schema');
    expect(data.execution_protocol).not.toHaveProperty('schema_inlined_for');
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(3_400);
  });

  it('does not inline a tool whose fields need a schema_id from the provider', async () => {
    const fixture = await create_fixture();
    await insert_tool(fixture, { node_name: 'export_rows', reload_props: true });

    const data = await search(fixture, 'export rows');

    expect(data.tools[0]).toMatchObject({ input_setup_steps: ['get_schema'] });
    expect(data.tools[0]).not.toHaveProperty('schema');
    expect(schema_fault.calls).toBe(0);
  });

  it.each([
    'fails',
    'throws',
  ] as const)('falls back to the plain result when get_tool_schema %s', async (mode) => {
    const fixture = await create_fixture();
    await insert_tool(fixture, { node_name: 'export_rows' });
    const inlined = await search(fixture, 'export rows');

    schema_fault.mode = mode;
    const plain = await search(fixture, 'export rows');

    expect(plain.tools[0]).not.toHaveProperty('schema');
    expect(plain.execution_protocol).not.toHaveProperty('schema_inlined_for');
    const [inlined_top] = inlined.tools;
    if (!inlined_top) throw new Error('Expected one search result');
    const { schema: _schema, ...inlined_summary } = inlined_top;
    expect(plain.tools).toEqual([inlined_summary]);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  await db.insert(apps).values({
    app_id: `app_${app_name}`,
    app_name,
    app_key: app_name,
    catalog_scope: 'global',
    app_display_name: 'Zebra Ledger',
    auth_type: 'none',
    app_status: 'active',
    metadata: { source: 'composio' },
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
  const schema_context = {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: 'run_inline_schema',
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  };
  return { db, user_id: bootstrap.user_id, schema_context };
}

async function insert_tool(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  input: { node_name: string; field_description_length?: number; reload_props?: boolean },
) {
  await fixture.db.insert(nodes).values({
    node_id: `node_${app_name}_${input.node_name}`,
    app_id: `app_${app_name}`,
    app_key: app_name,
    node_name: input.node_name,
    catalog_scope: 'global',
    node_key: `${app_name}-${input.node_name}-1`,
    node_version: 1,
    node_display_name: input.node_name,
    node_kind: 'action',
    input_schema: {
      type: 'object',
      properties: {
        sheet_id: {
          type: 'string',
          description: 'd'.repeat(input.field_description_length ?? 20),
          ...(input.reload_props ? { field: { reload_props: true } } : {}),
        },
      },
    },
    runtime_handler: `composio.${input.node_name}`,
    node_runtime: 'connected_app',
    provider_key: 'composio',
    metadata: { source: 'composio', description: `Zebra ledger ${input.node_name}` },
    created_by: fixture.user_id,
    last_updated_by: fixture.user_id,
  });
}

async function search(fixture: Awaited<ReturnType<typeof create_fixture>>, query: string) {
  const result = await runtime_search_tools_tool.execute(
    { query, app_name, max_results: 50, offset: 0 },
    { db: fixture.db, ...fixture.schema_context },
  );
  if (!result.success) throw new Error('Expected runtime-search_tools-1 to succeed');
  return result.data as SearchData;
}

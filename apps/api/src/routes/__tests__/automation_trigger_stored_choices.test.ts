import { create_fixture } from '@api/routes/__tests__/trigger_choices_fixture';
import { nodes } from '@coworker/core/db/schema';
import type * as executors from '@runtime-platform/tools/catalog_tool_executors';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

const provider_call = vi.hoisted(() => vi.fn<executors.CatalogToolExecutor>());
vi.mock('@runtime-platform/tools/catalog_tool_executors', async (import_original) => ({
  ...(await import_original<typeof executors>()),
  find_catalog_tool_executor: () => provider_call,
}));

const folder_choices_url =
  '/v1/automations/trigger-types/gmail-message_received-1/fields/folderId/choices?connection_id=conn_mail';

async function fixture_with_stored_alias() {
  const fixture = await create_fixture();
  await fixture.db
    .update(nodes)
    .set({
      input_schema: {
        type: 'object',
        properties: {
          labelIds: { type: 'string' },
          query: { type: 'string' },
          folderId: { type: 'string' },
        },
      },
      node_config: {
        sourced_from: { provider_app_id: 'gmail' },
        field_choices: {
          fingerprint: 'f1',
          fields: {
            folderId: {
              action_node_name: 'list_labels',
              items_path: ['data', 'folders'],
              value_path: ['id'],
              label_path: ['name'],
            },
          },
        },
      },
    })
    .where(eq(nodes.node_id, 'node_mail'));
  return fixture;
}

describe('a trigger box filled from a stored alias', () => {
  it('reads as a dropdown in the trigger types', async () => {
    const fixture = await fixture_with_stored_alias();
    const response = await fixture.app.request('/v1/automations/trigger-types');
    const mail = (await response.json()).data.apps.find(
      (app: { app_name: string }) => app.app_name === 'gmail',
    );
    const fields = mail.trigger_types[0].setup_fields as {
      name: string;
      choices_from_provider: boolean;
    }[];
    expect(fields.find((field) => field.name === 'folderId')?.choices_from_provider).toBe(true);
    expect(fields.find((field) => field.name === 'query')?.choices_from_provider).toBe(false);
  });

  it('runs the stored action and reads its list, with or without the data wrapper', async () => {
    const fixture = await fixture_with_stored_alias();
    provider_call.mockResolvedValue({
      success: true,
      data: {
        node_key: 'gmail-labels-in-this-env-7',
        app_name: 'gmail',
        node_name: 'list_labels',
        output: {
          folders: [
            { id: 'F2', name: 'Receipts' },
            { id: 'F1', name: 'Clients' },
          ],
        },
      },
    });
    const response = await fixture.app.request(folder_choices_url);
    expect(response.status).toBe(200);
    expect((await response.json()).data.choices).toEqual([
      { value: 'F1', label: 'Clients' },
      { value: 'F2', label: 'Receipts' },
    ]);
    expect(provider_call.mock.lastCall?.[1]).toMatchObject({
      node_key: 'gmail-labels-in-this-env-7',
    });
  });

  it('still answers 404 for a box with neither a hint nor a stored alias', async () => {
    const fixture = await fixture_with_stored_alias();
    const response = await fixture.app.request(
      '/v1/automations/trigger-types/gmail-message_received-1/fields/query/choices?connection_id=conn_mail',
    );
    expect(response.status).toBe(404);
  });
});

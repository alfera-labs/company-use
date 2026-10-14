import {
  create_fixture,
  insert_attio_connection,
  stub_composio_api,
  tool_context,
} from '@runtime-platform/__tests__/composio_execution_fixture';
import { reset_composio_client_for_tests } from '@runtime-platform/composio/composio_client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Composio execution without an API key', () => {
  beforeEach(() => {
    reset_composio_client_for_tests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('refuses the call and names the missing setting', async () => {
    expect(process.env.COMPOSIO_API_KEY ?? '').toBe('');
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { stubbed_fetch } = stub_composio_api([]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'composio_not_configured',
      error_message: 'Composio execution requires COMPOSIO_API_KEY.',
      metadata: { node_key: 'attio-list_records-1' },
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });
});

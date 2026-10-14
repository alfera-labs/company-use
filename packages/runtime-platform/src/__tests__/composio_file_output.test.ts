import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import type { SessionEnv } from '@agent-core/environment';
import {
  create_fixture,
  insert_attio_connection,
  read_content_json,
  stub_composio_api,
  tool_context,
} from '@runtime-platform/__tests__/composio_execution_fixture';
import { reset_composio_client_for_tests } from '@runtime-platform/composio/composio_client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { fetch_public_url } = vi.hoisted(() => ({ fetch_public_url: vi.fn() }));

vi.mock('@runtime-platform/tools/public_url_fetch', () => ({ fetch_public_url }));

const attachment_url = 'https://files.composio.dev/downloads/contract.pdf';
const pdf_bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function attachment_result() {
  return {
    successful: true,
    data: {
      attachments: [
        { file: { name: 'contract.pdf', mimetype: 'application/pdf', s3url: attachment_url } },
      ],
    },
  };
}

function writing_environment() {
  const written: Array<{ path: string; byte_length: number }> = [];
  const write_bytes = vi.fn(async (file_path: string, body: ReadableStream<Uint8Array>) => {
    let byte_length = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byte_length += value.byteLength;
    }
    written.push({ path: file_path, byte_length });
  });
  return {
    written,
    environment: { env_key: 'test', env_kind: 'custom', write_bytes } as unknown as SessionEnv,
  };
}

describe('Composio file outputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset_composio_client_for_tests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('saves a downloadable file nested in an array and hands the model its path', async () => {
    const { written, environment } = writing_environment();
    const fixture = await create_fixture({ environment });
    await insert_attio_connection(fixture);
    stub_composio_api([
      { path: '/tools/execute/ATTIO_LIST_ATTACHMENTS', respond: { body: attachment_result() } },
    ]);
    fetch_public_url.mockResolvedValue(
      new Response(pdf_bytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_attachments-1', input: { record_id: 'rec_1' } },
      tool_context(fixture),
    );

    expect(fetch_public_url).toHaveBeenCalledWith(attachment_url, {}, { timeout_ms: 30_000 });
    expect(written).toEqual([{ path: 'files/contract.pdf', byte_length: pdf_bytes.byteLength }]);
    const output = (
      read_content_json(result) as { output: { attachments: Array<{ file: unknown }> } }
    ).output;
    expect(output.attachments[0]?.file).toMatchObject({
      type: 'file',
      workspace_path: expect.stringContaining('files/contract.pdf'),
      byte_length: pdf_bytes.byteLength,
    });
    expect(JSON.stringify(output)).not.toContain('s3url');
  });

  it('keeps the provider object and succeeds when the download is refused', async () => {
    const { written, environment } = writing_environment();
    const fixture = await create_fixture({ environment });
    await insert_attio_connection(fixture);
    stub_composio_api([
      { path: '/tools/execute/ATTIO_LIST_ATTACHMENTS', respond: { body: attachment_result() } },
    ]);
    fetch_public_url.mockResolvedValue(new Response('not found', { status: 404 }));

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_attachments-1', input: { record_id: 'rec_1' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({ ok: true });
    expect(written).toEqual([]);
    const output = (
      read_content_json(result) as { output: { attachments: Array<{ file: unknown }> } }
    ).output;
    expect(output.attachments[0]?.file).toEqual({
      name: 'contract.pdf',
      mimetype: 'application/pdf',
      s3url: attachment_url,
    });
  });
});

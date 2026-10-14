import type { SessionEnv } from '@agent-core/environment';
import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import { find_workspace_tool } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

function read_document_tool() {
  const tool = find_workspace_tool('workspace-read_document');
  if (!tool?.execute) throw new Error('workspace-read_document is not registered');
  return tool;
}

function context_reading(read_bytes?: SessionEnv['read_bytes']): RuntimeToolContext {
  const environment: SessionEnv = { env_key: 'env_test', env_kind: 'remote_sandbox' };
  if (read_bytes) environment.read_bytes = read_bytes;
  return {
    run_key: 'run_test',
    tool_call_id: 'tcall_test',
    metadata: {},
    environment,
  };
}

function reading_bytes(bytes: Uint8Array) {
  return context_reading(async () => bytes);
}

const csv_bytes = new TextEncoder().encode('product,price\nNegroamaro,12\nPrimitivo,15\n');

describe('workspace-read_document', () => {
  it('converts a csv into a markdown table through the real converter', async () => {
    const result = await read_document_tool().execute?.(
      { path: 'prices.csv' },
      reading_bytes(csv_bytes),
    );

    if (!result?.ok) throw new Error('expected success');
    expect(result.content_text).toContain('| product | price |');
    expect(result.content_text).toContain('| Negroamaro | 12 |');
    expect(result.metadata?.document_format).toBe('csv');
  });

  it('detects the format from the bytes, not the extension', async () => {
    const rtf_bytes = new TextEncoder().encode('{\\rtf1\\ansi Hello from RTF}');
    const result = await read_document_tool().execute?.(
      { path: 'mislabeled.docx' },
      reading_bytes(rtf_bytes),
    );

    if (!result?.ok) throw new Error('expected success');
    expect(result.content_text).toContain('Hello from RTF');
  });

  it('says a random binary is not a document instead of failing to parse it', async () => {
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    const result = await read_document_tool().execute?.({ path: 'blob.bin' }, reading_bytes(junk));

    if (result?.ok) throw new Error('expected failure');
    expect(result?.error_code).toBe('not_a_document');
    expect(result?.error_message).toContain('workspace-read_file');
  });

  it('refuses an oversized file with the limit in the message', async () => {
    const huge = new Uint8Array(26 * 1024 * 1024);
    const result = await read_document_tool().execute?.({ path: 'huge.xlsx' }, reading_bytes(huge));

    if (result?.ok) throw new Error('expected failure');
    expect(result?.error_code).toBe('document_too_large');
    expect(result?.error_message).toContain('25MB');
  });

  it('answers document_unreadable when the provider throws on a missing path', async () => {
    const context = context_reading(async () => {
      throw new Error('ENOENT: no such file or directory');
    });

    const result = await read_document_tool().execute?.({ path: 'missing.pdf' }, context);

    if (result?.ok) throw new Error('expected failure');
    expect(result?.error_code).toBe('document_unreadable');
  });

  it('reports an unreadable path honestly', async () => {
    const result = await read_document_tool().execute?.({ path: 'missing.pdf' }, context_reading());

    if (result?.ok) throw new Error('expected failure');
    expect(result?.error_code).toBe('document_unreadable');
  });
});

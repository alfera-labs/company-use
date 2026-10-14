import { build_file_fetch_requests } from '@connectors/sync/file_fetch_request';
import type { ConnectorSyncFile } from '@connectors/sync_types';
import { describe, expect, it } from 'vitest';

const files: ConnectorSyncFile[] = [
  { id: 'f1', name: 'one.pdf', mime_type: 'application/pdf' },
  { id: 'f2', name: 'two.png', mime_type: 'image/png' },
];

describe('build_file_fetch_requests', () => {
  it('evaluates the file_fetch_input expression per file', () => {
    const requests = build_file_fetch_requests({ attachment_id: { $: 'file.id' } }, files);
    expect(requests).toEqual([
      { file: files[0], input: { attachment_id: 'f1' } },
      { file: files[1], input: { attachment_id: 'f2' } },
    ]);
  });

  it('gives every file its own fresh input object', () => {
    const requests = build_file_fetch_requests({ attachment_id: { $: 'file.id' } }, files);
    expect(requests[0]?.input).not.toBe(requests[1]?.input);
  });

  it('returns an empty list for an empty file list', () => {
    expect(build_file_fetch_requests({ attachment_id: { $: 'file.id' } }, [])).toEqual([]);
  });
});

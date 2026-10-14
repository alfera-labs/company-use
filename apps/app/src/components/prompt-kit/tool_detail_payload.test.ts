import { describe, expect, it } from 'vitest';
import {
  read_tool_detail_input,
  read_tool_detail_output,
} from '@/components/prompt-kit/tool_detail_payload';

const stored_input = {
  input: { query: "name contains 'questionnaire'", includeItemsFromAllDrives: true },
  node_key: 'google_drive-search_files-1',
};

const stored_output = {
  data: {
    output: {
      ret: [],
      exports: { $summary: 'Found 0 files matching query "name contains \'questionnaire\'"' },
      stash_id: null,
      observations: [],
    },
    app_name: 'google_drive',
    node_key: 'google_drive-search_files-1',
    node_name: 'search_files',
    verification: { reason: 'tool_input_has_no_content_expectation', status: 'not_applicable' },
  },
  success: true,
  metadata: {
    source: 'composio',
    node_id: 'node_00000000000000000000000000000001',
    node_version: 1,
    verification: { reason: 'tool_input_has_no_content_expectation', status: 'not_applicable' },
    connection_id: 'conn_01000000000000000000000005',
    node_provenance: {
      provider: 'composio',
      provider_app_id: 'app_1lxhk1',
      provider_component_id: 'google_drive-search-files',
      synced_from_catalog_time: '2026-07-15T08:39:52.859Z',
      provider_component_version: '0.0.2',
    },
    runtime_handler: 'composio.google_drive-search-files',
    external_user_id: 'ws_ws_123',
    workspace_file_count: 0,
    provider_component_id: 'google_drive-search-files',
  },
};

describe('read_tool_detail_input', () => {
  it('shows the arguments the tool was called with, and the node key', () => {
    expect(read_tool_detail_input(stored_input)).toEqual({
      query: "name contains 'questionnaire'",
      includeItemsFromAllDrives: true,
      node_key: 'google_drive-search_files-1',
    });
  });

  it('leaves an input that is not wrapped alone', () => {
    expect(read_tool_detail_input({ path: 'notes.md' })).toEqual({ path: 'notes.md' });
  });
});

describe('read_tool_detail_output', () => {
  it('drops every field that describes plumbing rather than the result', () => {
    const shown = read_tool_detail_output(stored_output) as Record<string, unknown>;

    expect(Object.keys(shown)).toEqual(['summary', 'result']);
    expect(shown.summary).toBe('Found 0 files matching query "name contains \'questionnaire\'"');
    expect(shown.result).toEqual([]);
  });

  it('cuts the rendered payload to a fraction of the envelope', () => {
    const before = JSON.stringify(stored_output).length;
    const after = JSON.stringify(read_tool_detail_output(stored_output)).length;

    expect(before).toBeGreaterThan(900);
    expect(after).toBeLessThan(150);
  });

  it('keeps a real payload whole — nothing here is truncated', () => {
    const files = Array.from({ length: 40 }, (_, index) => ({ id: `file_${index}` }));
    const shown = read_tool_detail_output({
      data: {
        output: { ret: files, exports: { $summary: 'Found 40 files' } },
        node_key: 'google_drive-search_files-1',
      },
      success: true,
      metadata: { source: 'composio' },
    }) as { result: unknown[] };

    expect(shown.result).toHaveLength(40);
  });

  it('passes a failed envelope through so the error stays visible', () => {
    const failure = {
      success: false,
      error: { code: 'command_failed', message: 'exit 127' },
      metadata: { source: 'workspace' },
    };

    expect(read_tool_detail_output(failure)).toEqual(failure.error);
  });

  it('leaves a tool that does not use the envelope untouched', () => {
    const workspace_output = { stdout: 'hello\n', exitCode: 0 };

    expect(read_tool_detail_output(workspace_output)).toEqual(workspace_output);
  });

  it('leaves a payload alone when it only looks like the node wrapper', () => {
    const shaped_like_a_node = { output: 'the file contents', app_name: 'not a node', extra: 1 };

    expect(read_tool_detail_output(shaped_like_a_node)).toEqual(shaped_like_a_node);
  });
});

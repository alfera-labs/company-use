import { describe, expect, it } from 'vitest';
import { say_action_in_tense } from '@/components/app/tool_action_words';
import { resolve_system_tool_icon, resolve_system_tool_label } from '@/lib/system_tool_icon';

const system_node_keys = [
  'runtime-web_search-1',
  'runtime-read_url-1',
  'runtime-image_search-1',
  'runtime-search_tools-1',
  'runtime-get_tool_schema-1',
  'runtime-execute_tool-1',
  'runtime-configure_tool-1',
  'runtime-search_context-1',
  'runtime-search_documents-1',
  'runtime-read_document-1',
  'runtime-load_skill-1',
  'runtime-read_attachment-1',
  'runtime-list_connections-1',
  'runtime-create_connection-1',
  'scheduled_tasks-create_scheduled_task-1',
  'scheduled_tasks-edit_scheduled_task-1',
  'scheduled_tasks-list_scheduled_tasks-1',
  'scheduled_tasks-delete_scheduled_task-1',
  'scheduled_tasks-set_scheduled_task_status-1',
  'workspace-run_command',
  'workspace-read_file',
  'workspace-write_file',
  'workspace-edit_file',
  'workspace-grep',
  'workspace-glob',
  'workspace-list_files',
  'workspace-view_image',
  'workspace-preview',
  'browser',
  'math-calculate-1',
];

describe('resolve_system_tool_icon', () => {
  it('maps every known system tool to a glyph', () => {
    for (const node_key of system_node_keys) {
      expect(resolve_system_tool_icon(node_key), node_key).toBeDefined();
    }
  });

  it('ignores the catalog version suffix', () => {
    expect(resolve_system_tool_icon('runtime-web_search-1')).toBe(
      resolve_system_tool_icon('runtime-web_search-42'),
    );
  });

  it('normalizes legacy dotted tool names', () => {
    expect(resolve_system_tool_icon('sandbox.view_image')).toBe(
      resolve_system_tool_icon('sandbox-view_image'),
    );
  });

  it('falls back to the app-family glyph for an unmapped system tool', () => {
    expect(resolve_system_tool_icon('runtime-some_future_tool-1')).toBeDefined();
    expect(resolve_system_tool_icon('sandbox-some_future_tool')).toBeDefined();
  });

  it('returns undefined for third-party integrations so they keep their brand logo', () => {
    expect(resolve_system_tool_icon('slack-send_message-1')).toBeUndefined();
    expect(resolve_system_tool_icon('attio-create_update_record-1')).toBeUndefined();
    expect(resolve_system_tool_icon('gmail-find_email-1')).toBeUndefined();
  });
});

describe('Brain', () => {
  const brain_node_keys = ['runtime-search_documents-1', 'runtime-read_document-1'];

  it('draws both with the same glyph', () => {
    const glyphs = new Set(brain_node_keys.map((node_key) => resolve_system_tool_icon(node_key)));
    expect(glyphs.size).toBe(1);
    expect([...glyphs][0]).not.toBe(resolve_system_tool_icon('runtime-some_future_tool-1'));
  });

  it('keeps the session search out of the brain, in words and in glyph', () => {
    expect(resolve_system_tool_label('runtime-search_context-1')).toBe(
      'Looking back through this chat',
    );
    expect(say_action_in_tense('Looking back through this chat', 'done')).toBe(
      'Looked back through this chat',
    );
    expect(resolve_system_tool_icon('runtime-search_context-1')).not.toBe(
      resolve_system_tool_icon('runtime-search_documents-1'),
    );
  });
});

describe('resolve_system_tool_label', () => {
  it('leaves tools whose own display name already reads well alone', () => {
    expect(resolve_system_tool_label('workspace-read_file')).toBeUndefined();
    expect(resolve_system_tool_label('gmail-find_email-1')).toBeUndefined();
  });
});

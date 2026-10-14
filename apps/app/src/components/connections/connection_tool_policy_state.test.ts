import { describe, expect, it } from 'vitest';
import {
  filter_connection_tools,
  get_connection_preset,
  get_group_policy_change,
  get_preset_policy_change,
  get_tool_mode,
  get_tool_policy_change,
} from '@/components/connections/connection_tool_policy_state';
import type { ConnectionTool, ToolPolicy, ToolPolicyMode } from '@/lib/api/types';

const read_tool = tool('gmail-read_email-1', 'Read email', 'only_reads');
const write_tool = tool('gmail-send_email-1', 'Send email', 'changes_things');

describe('connection tool policy state', () => {
  it('derives the ask-for-writes preset from group rules', () => {
    const policies = [
      policy('default', 'node_label', 'every_tool', 'allow'),
      policy('writes', 'node_label', 'changes_things', 'ask'),
    ];

    expect(get_tool_mode(read_tool, policies)).toBe('allow');
    expect(get_tool_mode(write_tool, policies)).toBe('ask');
    expect(get_connection_preset([read_tool, write_tool], policies)).toBe('ask_for_writes');
  });

  it('removes an exact rule when the selected mode matches its inherited rule', () => {
    const policies = [
      policy('writes', 'node_label', 'changes_things', 'ask'),
      policy('send', 'node', write_tool.node_key, 'never'),
    ];

    expect(get_tool_policy_change(write_tool, policies, 'ask')).toEqual({
      delete_policy_ids: ['send'],
      set_policies: [],
    });
  });

  it('replaces all narrower rules inside one tool group', () => {
    const policies = [
      policy('read', 'node', read_tool.node_key, 'never'),
      policy('send', 'node', write_tool.node_key, 'never'),
      policy('email', 'node_label', 'emails_outsiders', 'ask'),
    ];

    expect(
      get_group_policy_change('changes_things', [read_tool, write_tool], policies, 'allow'),
    ).toEqual({
      delete_policy_ids: ['send', 'email'],
      set_policies: [
        { resource_type: 'node_label', resource_id: 'changes_things', policy_mode: 'allow' },
      ],
    });
  });

  it('builds one replacement for the global writes preset', () => {
    const policies = [
      policy('read', 'node', read_tool.node_key, 'never'),
      policy('writes', 'node_label', 'changes_things', 'never'),
      policy('other', 'document', 'doc_1', 'ask'),
    ];

    expect(get_preset_policy_change(policies, 'ask_for_writes')).toEqual({
      delete_policy_ids: ['read', 'writes'],
      set_policies: [
        { resource_type: 'node_label', resource_id: 'every_tool', policy_mode: 'allow' },
        { resource_type: 'node_label', resource_id: 'changes_things', policy_mode: 'ask' },
      ],
    });
  });

  it('searches tool display names and keys', () => {
    expect(filter_connection_tools([read_tool, write_tool], 'send')).toEqual([write_tool]);
    expect(filter_connection_tools([read_tool, write_tool], 'read_email')).toEqual([read_tool]);
  });
});

function tool(
  node_key: string,
  node_display_name: string,
  policy_group: ConnectionTool['policy_group'],
) {
  const policy_label_ids = [policy_group, 'every_tool'];
  return {
    node_key,
    node_name: node_key,
    node_display_name,
    policy_group,
    policy_label_ids,
  } as ConnectionTool;
}

function policy(
  policy_id: string,
  resource_type: string,
  resource_id: string,
  policy_mode: ToolPolicyMode,
) {
  return { policy_id, resource_type, resource_id, policy_mode } as ToolPolicy;
}

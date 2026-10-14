import { describe, expect, it } from 'vitest';
import {
  build_tool_sections,
  get_section_policy_change,
} from '@/components/connections/connection_tool_sections';
import type { ConnectionTool, ToolPolicy } from '@/lib/api/types';

const sessions = { group_key: 'sessions', title: 'Sessions', description: 'Work.', position: 0 };
const identity = { group_key: 'identity', title: 'Identity', description: 'Who.', position: 9 };

describe('connection tool sections', () => {
  it('keeps the read-only / write split for tools without a group', () => {
    const read_tool = tool('gmail-read_email-1', 'only_reads', null);
    const write_tool = tool('gmail-send_email-1', 'changes_things', null);

    expect(build_tool_sections([read_tool, write_tool])).toEqual([
      {
        section_key: 'only_reads',
        label: 'Read-only tools',
        description: null,
        policy_group: 'only_reads',
        tools: [read_tool],
      },
      {
        section_key: 'changes_things',
        label: 'Write/delete tools',
        description: null,
        policy_group: 'changes_things',
        tools: [write_tool],
      },
    ]);
  });

  it('lists grouped tools by family in position order', () => {
    const whoami = tool('alfera_api-whoami-1', 'only_reads', identity);
    const create = tool('alfera_api-create_session-1', 'changes_things', sessions);
    const get = tool('alfera_api-get_session-1', 'only_reads', sessions);

    expect(build_tool_sections([whoami, create, get])).toEqual([
      {
        section_key: 'sessions',
        label: 'Sessions',
        description: 'Work.',
        policy_group: null,
        tools: [create, get],
      },
      {
        section_key: 'identity',
        label: 'Identity',
        description: 'Who.',
        policy_group: null,
        tools: [whoami],
      },
    ]);
  });

  it('sets a family with one rule per tool in it, never a label rule', () => {
    const create = tool('alfera_api-create_session-1', 'changes_things', sessions);
    const get = tool('alfera_api-get_session-1', 'only_reads', sessions);
    const whoami = tool('alfera_api-whoami-1', 'only_reads', identity);
    const [section] = build_tool_sections([create, get, whoami]);
    const policies = [
      { policy_id: 'old', resource_type: 'node', resource_id: create.node_key, policy_mode: 'ask' },
    ] as ToolPolicy[];

    expect(section && get_section_policy_change(section, [create, get], policies, 'never')).toEqual(
      {
        delete_policy_ids: ['old'],
        set_policies: [
          { resource_type: 'node', resource_id: create.node_key, policy_mode: 'never' },
          { resource_type: 'node', resource_id: get.node_key, policy_mode: 'never' },
        ],
      },
    );
  });
});

function tool(
  node_key: string,
  policy_group: ConnectionTool['policy_group'],
  tool_group: ConnectionTool['tool_group'],
) {
  return {
    node_key,
    node_name: node_key,
    node_display_name: node_key,
    policy_group,
    policy_label_ids: [policy_group, 'every_tool'],
    tool_group,
  } as ConnectionTool;
}

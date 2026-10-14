import { describe, expect, it } from 'vitest';
import { read_connection_access_level } from '@/components/connections/connection_access_level';
import { get_preset_policy_change } from '@/components/connections/connection_tool_policy_state';
import type { ToolPolicy } from '@/lib/api/types';

function label(policy_id: string, resource_id: string, policy_mode: string): ToolPolicy {
  return { policy_id, resource_type: 'node_label', resource_id, policy_mode } as ToolPolicy;
}

describe('the three access levels a connection can be set to', () => {
  it('reads no rules at all as read and write, which is what the runtime does', () => {
    expect(read_connection_access_level([])).toBe('allow');
  });

  it('reads back every level it writes', () => {
    for (const level of ['read_only', 'ask_for_writes', 'allow'] as const) {
      const written = get_preset_policy_change([], level).set_policies.map((policy, index) =>
        label(`pol_${index}`, policy.resource_id, policy.policy_mode),
      );

      expect(read_connection_access_level(written)).toBe(level);
    }
  });

  it('blocks the writes and the outgoing mail for read only', () => {
    expect(get_preset_policy_change([], 'read_only').set_policies).toEqual([
      { resource_type: 'node_label', resource_id: 'only_reads', policy_mode: 'allow' },
      { resource_type: 'node_label', resource_id: 'changes_things', policy_mode: 'never' },
      { resource_type: 'node_label', resource_id: 'emails_outsiders', policy_mode: 'never' },
    ]);
  });

  it('replaces the rules it finds rather than adding to them', () => {
    const existing = [
      label('pol_reads', 'only_reads', 'never'),
      {
        policy_id: 'pol_tool',
        resource_type: 'node',
        resource_id: 'gmail-send',
        policy_mode: 'allow',
      } as ToolPolicy,
    ];

    expect(get_preset_policy_change(existing, 'allow').delete_policy_ids).toEqual([
      'pol_reads',
      'pol_tool',
    ]);
  });

  it('reports a rule written for one tool as custom, rather than rounding it to a level', () => {
    const policies = [
      label('pol_every', 'every_tool', 'allow'),
      {
        policy_id: 'pol_tool',
        resource_type: 'node',
        resource_id: 'gmail-send',
        policy_mode: 'never',
      } as ToolPolicy,
    ];

    expect(read_connection_access_level(policies)).toBeNull();
  });

  it('reports a mix of labels no level writes as custom', () => {
    expect(read_connection_access_level([label('pol_reads', 'only_reads', 'ask')])).toBeNull();
    expect(
      read_connection_access_level([
        label('pol_every', 'every_tool', 'allow'),
        label('pol_writes', 'changes_things', 'never'),
      ]),
    ).toBeNull();
  });

  it('ignores rules about other kinds of resource', () => {
    const policies = [
      {
        policy_id: 'pol_doc',
        resource_type: 'document',
        resource_id: 'doc_1',
        policy_mode: 'ask',
      } as ToolPolicy,
    ];

    expect(read_connection_access_level(policies)).toBe('allow');
  });
});

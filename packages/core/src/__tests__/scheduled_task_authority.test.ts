import {
  build_scheduled_task_run_authority,
  has_scheduled_task_run_authority,
  set_scheduled_task_authority,
} from '@coworker/core/services/scheduled_task_authority';
import { agent_heartbeat_actor, agent_heartbeat_config_key } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

describe('scheduled task authority', () => {
  it('authorizes only the exact instruction granted by a human', () => {
    const source = set_scheduled_task_authority({}, 'user_01', 'Send weekly update.');
    const authority = build_scheduled_task_run_authority(
      'trigger_01',
      source,
      'Send weekly update.',
    );

    expect(has_scheduled_task_run_authority(authority)).toBe(true);
    expect(
      build_scheduled_task_run_authority('trigger_01', source, 'Send payroll data.'),
    ).toBeNull();
  });

  it('does not let a system actor grant authority to itself', () => {
    const source = set_scheduled_task_authority(
      { [agent_heartbeat_config_key]: { source_event_id: 'event_01' } },
      agent_heartbeat_actor,
      'Send weekly update.',
    );

    expect(source).toEqual({ [agent_heartbeat_config_key]: { source_event_id: 'event_01' } });
    expect(
      build_scheduled_task_run_authority('trigger_01', source, 'Send weekly update.'),
    ).toBeNull();
  });

  it('rejects incomplete stored authority before granting a scheduled run', () => {
    const incomplete_authority = {
      delegated_authority: {
        version: 1 as const,
        kind: 'scheduled_task' as const,
        granted_by_actor_id: '',
        granted_time: 'not-a-time',
        instruction_sha256: 'not-a-hash',
      },
    };

    expect(
      build_scheduled_task_run_authority('trigger_01', incomplete_authority, 'Send weekly update.'),
    ).toBeNull();
    expect(
      has_scheduled_task_run_authority({
        ...incomplete_authority,
        delegated_authority: { ...incomplete_authority.delegated_authority, trigger_id: 'trg_01' },
      }),
    ).toBe(false);
  });

  it('requires a non-empty trigger id on otherwise complete run authority', () => {
    const source = set_scheduled_task_authority({}, 'user_01', 'Send weekly update.');
    const authority = build_scheduled_task_run_authority('', source, 'Send weekly update.');

    expect(authority).toBeNull();
    expect(has_scheduled_task_run_authority(authority)).toBe(false);
  });
});

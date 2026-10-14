import {
  decide_run_audience,
  is_audience_narrower_than_workspace,
  type RunAudienceFacts,
  read_room_audience,
  read_run_audience,
} from '@runtime-platform/orchestrator/run_audience';
import { workspace_path_is_durable } from '@runtime-platform/storage/workspace_layouts';
import { room_of_parent_call } from '@runtime-platform/tools/nested_tool_call_room';
import { tool_output_path } from '@runtime-platform/tools/tool_output_path';
import { describe, expect, it } from 'vitest';

function facts(overrides: Partial<RunAudienceFacts>): RunAudienceFacts {
  return {
    project_access: null,
    session_source: 'dashboard',
    slack_channel_type: null,
    workspace_member_count: 2,
    ...overrides,
  };
}

const cases: Array<[string, Partial<RunAudienceFacts>, 'workspace' | 'narrow', boolean]> = [
  ['a personal room', { project_access: 'private' }, 'narrow', false],
  ['a members-only project', { project_access: 'members' }, 'narrow', false],
  ['a workspace project', { project_access: 'workspace' }, 'workspace', false],
  ['an access value nobody knows', { project_access: 'guests' }, 'narrow', false],
  ['a Slack DM', { session_source: 'slack', slack_channel_type: 'im' }, 'narrow', false],
  ['a Slack group DM', { session_source: 'slack', slack_channel_type: 'mpim' }, 'narrow', false],
  [
    'a private Slack channel',
    { session_source: 'slack', slack_channel_type: 'group' },
    'narrow',
    false,
  ],
  [
    'a public Slack channel',
    { session_source: 'slack', slack_channel_type: 'channel' },
    'workspace',
    false,
  ],
  ['a Slack thread with no channel type', { session_source: 'slack' }, 'narrow', true],
  [
    'a public Slack channel bound to a members-only project',
    { session_source: 'slack', slack_channel_type: 'channel', project_access: 'members' },
    'narrow',
    false,
  ],
  [
    'a Slack DM in a workspace project',
    { session_source: 'slack', slack_channel_type: 'im', project_access: 'workspace' },
    'narrow',
    false,
  ],
  ['an email thread', { session_source: 'email' }, 'workspace', true],
  [
    'an email thread in a workspace project',
    { session_source: 'email', project_access: 'workspace' },
    'workspace',
    false,
  ],
  ['an API chat', { session_source: 'api' }, 'workspace', true],
  [
    'an email thread in a private project',
    { session_source: 'email', project_access: 'private' },
    'narrow',
    false,
  ],
  ['a schedule with no recorded audience', { session_source: 'trigger' }, 'workspace', true],
  ['a dashboard chat with no project', { session_source: 'dashboard' }, 'workspace', true],
  ['a dashboard chat in a workspace project', { project_access: 'workspace' }, 'workspace', false],
];

describe('deciding who reads a run', () => {
  it.each(cases)('%s is %s', (_name, overrides, run_audience, is_fallback) => {
    const decision = decide_run_audience(facts(overrides));
    expect(decision.run_audience).toBe(run_audience);
    expect(decision.is_fallback).toBe(is_fallback);
    expect(is_audience_narrower_than_workspace(facts(overrides))).toBe(run_audience === 'narrow');
  });

  it('names the fact that decided', () => {
    expect(decide_run_audience(facts({ project_access: 'private' })).reason).toBe(
      'project_access:private',
    );
    expect(decide_run_audience(facts({ session_source: 'trigger' })).reason).toBe(
      'no_privacy_fact:trigger',
    );
  });
});

describe('reading a run room', () => {
  it('keeps the personal room owner and adds the audience', () => {
    const session = { session_id: 'ses_1', session_source: 'dashboard', source_metadata: {} };
    expect(
      read_room_audience(session, { project_access: 'private', personal_for_user_id: 'usr_1' }, 2),
    ).toEqual({ room_private_to: 'usr_1', run_audience: 'narrow' });
  });

  it('reads the Slack channel type the session stored', () => {
    const session = {
      session_id: 'ses_1',
      session_source: 'slack',
      source_metadata: { slack: { channel_type: 'channel' } },
    };
    expect(read_room_audience(session, null, 2)).toEqual({
      room_private_to: null,
      run_audience: 'workspace',
    });
  });
});

describe('reading the audience a tool call ran with', () => {
  it('accepts only the two audiences', () => {
    expect(read_run_audience({ run_audience: 'workspace' })).toBe('workspace');
    expect(read_run_audience({ run_audience: 'narrow' })).toBe('narrow');
    expect(read_run_audience({ run_audience: 'everyone' })).toBeNull();
    expect(read_run_audience({})).toBeNull();
    expect(read_run_audience(undefined)).toBeNull();
  });
});

describe('where a run saves a tool result too big to show', () => {
  it.each([
    [{ run_audience: 'workspace' }, 'system/tool-output/tc_1.txt', true],
    [{ run_audience: 'narrow' }, 'tmp/tool-output/tc_1.txt', false],
    [{}, 'tmp/tool-output/tc_1.txt', false],
  ])('%o saves to %s', (metadata, expected_path, is_on_the_shared_volume) => {
    const saved_path = tool_output_path({ run_key: 'run_1', metadata }, 'tc_1.txt');
    expect(saved_path).toBe(expected_path);
    expect(workspace_path_is_durable(saved_path)).toBe(is_on_the_shared_volume);
  });
});

describe('a tool call made from inside another tool call', () => {
  it('keeps the parent run audience, so its spills land where the parent run writes', () => {
    const forwarded = room_of_parent_call({
      room_private_to: null,
      tool_context_metadata: { run_audience: 'workspace' },
    });
    const metadata = forwarded.tool_context_metadata;
    expect(tool_output_path({ run_key: 'run_1', metadata }, 'a.json')).toBe(
      'system/tool-output/a.json',
    );
  });

  it('falls back to scratch when the parent named no audience', () => {
    const forwarded = room_of_parent_call({ room_private_to: 'usr_1' });
    expect(forwarded).toEqual({ room_private_to: 'usr_1' });
    expect(tool_output_path({ run_key: 'run_1', metadata: undefined }, 'a.json')).toBe(
      'tmp/tool-output/a.json',
    );
  });
});

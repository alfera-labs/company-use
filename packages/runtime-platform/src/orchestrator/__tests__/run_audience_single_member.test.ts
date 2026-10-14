import { build_workspace_protocol } from '@runtime-platform/orchestrator/context/workspace_protocol';
import { type RunAudience, read_room_audience } from '@runtime-platform/orchestrator/run_audience';
import { tool_output_path } from '@runtime-platform/tools/tool_output_path';
import { describe, expect, it } from 'vitest';

const daily_log_line = 'Append one short entry to daily-logs/<today>.md at the very end';

type Project = { project_access: string; personal_for_user_id: string | null };

const personal_project: Project = { project_access: 'private', personal_for_user_id: 'usr_zq_1' };

const run_shapes: Array<[string, string, Project | null]> = [
  ['a trigger run with no project', 'trigger', null],
  ['an email run with no project', 'email', null],
  ['a chat in a private personal project', 'dashboard', personal_project],
];

function room(session_source: string, project: Project | null, member_count: number) {
  const session = { session_id: 'ses_zq_1', session_source, source_metadata: {} };
  return read_room_audience(session, project, member_count);
}

function run_writes(run_audience: RunAudience) {
  return {
    protocol: build_workspace_protocol({ workspace_root: '/workspace', run_audience }),
    spill: tool_output_path({ run_key: 'run_zq_1', metadata: { run_audience } }, 'tc_1.txt'),
  };
}

describe('a workspace with one member keeps its daily log', () => {
  it.each(run_shapes)('%s writes the daily log and the shared activity', (_, source, project) => {
    const { run_audience } = room(source, project, 1);
    expect(run_audience).toBe('workspace');
    const { protocol, spill } = run_writes(run_audience);
    expect(protocol).toContain(daily_log_line);
    expect(protocol).toContain('system/activity/ holds every tool call you have made');
    expect(spill).toBe('system/tool-output/tc_1.txt');
  });

  it('keeps the personal room owner', () => {
    expect(room('dashboard', personal_project, 1).room_private_to).toBe('usr_zq_1');
  });
});

describe('a workspace with more than one member is workspace-wide unless a fact says private', () => {
  const unmarked_runs: Array<[string, string]> = [
    ['a trigger run with no project', 'trigger'],
    ['an email run with no project', 'email'],
    ['a dashboard chat with no project', 'dashboard'],
  ];

  it.each(unmarked_runs)('%s writes the daily log', (_, source) => {
    const { run_audience } = room(source, null, 2);
    expect(run_audience).toBe('workspace');
    expect(run_writes(run_audience).protocol).toContain(daily_log_line);
  });

  it('keeps a chat in a private personal project off the shared log', () => {
    const { run_audience } = room('dashboard', personal_project, 2);
    expect(run_audience).toBe('narrow');
    const { protocol, spill } = run_writes(run_audience);
    expect(protocol).not.toContain(daily_log_line);
    expect(spill).toBe('tmp/tool-output/tc_1.txt');
  });

  it('keeps an email run in a private project off the shared log', () => {
    expect(room('email', personal_project, 2).run_audience).toBe('narrow');
  });

  it('logs a workspace project chat as before', () => {
    const project = { project_access: 'workspace', personal_for_user_id: null };
    expect(room('dashboard', project, 2).run_audience).toBe('workspace');
  });
});

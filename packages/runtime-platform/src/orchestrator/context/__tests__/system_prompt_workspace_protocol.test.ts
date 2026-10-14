import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import type { RunAudience } from '@runtime-platform/orchestrator/run_audience';
import { workspace_layout_for_version } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it } from 'vitest';

function workspace_protocol(layout_version?: number, run_audience: RunAudience = 'workspace') {
  const prompt = build_system_prompt({
    system_instructions: 'x',
    workspace_root: '/workspace',
    run_audience,
    ...(layout_version ? { workspace_layout: workspace_layout_for_version(layout_version) } : {}),
  });
  const start = prompt.indexOf('## Workspace Protocol');
  return prompt.slice(start, prompt.indexOf('\n## ', start + 5));
}

describe('the Workspace Protocol', () => {
  it('names no folder an older workspace does not have', () => {
    const protocol = workspace_protocol(1);
    for (const folder of ['people', 'companies', 'websites', 'daily-logs', 'skills/', 'files/']) {
      expect(protocol).not.toContain(folder);
    }
  });

  it('tells an older workspace to write nothing new into itself', () => {
    const protocol = workspace_protocol(1);
    expect(protocol).not.toContain('append one short entry');
    expect(protocol).not.toContain('write the procedure down');
    expect(protocol).toContain('the shape its owner built');
  });

  it('still describes the current layout in full', () => {
    const protocol = workspace_protocol(2);
    for (const folder of ['people', 'companies', 'daily-logs', 'skills/', 'files/']) {
      expect(protocol).toContain(folder);
    }
  });

  it('is unchanged when no layout is given', () => {
    expect(workspace_protocol(undefined)).toBe(workspace_protocol(2));
  });

  it('asks a workspace-wide run for a daily-log entry and points it at the shared activity log', () => {
    const protocol = workspace_protocol(2, 'workspace');
    expect(protocol).toContain('Append one short entry to daily-logs/<today>.md');
    expect(protocol).toContain('system/activity/ holds every tool call you have made');
  });

  it('asks a private run for no daily-log entry and points it at its own scratch log', () => {
    const protocol = workspace_protocol(2, 'narrow');
    expect(protocol).not.toContain('Append one short entry');
    expect(protocol).not.toMatch(/append[^.]*daily-logs/iu);
    expect(protocol).not.toContain('system/activity');
    expect(protocol).toContain('This chat is private to the people in it, so it is not logged');
    expect(protocol).toContain('tmp/activity/');
    expect(protocol).toContain('tmp/tool-output/');
    expect(protocol).not.toContain('system/tool-output');
  });

  it('treats a run that does not name its audience as private', () => {
    const prompt = build_system_prompt({ system_instructions: 'x', workspace_root: '/workspace' });
    expect(prompt).not.toContain('Append one short entry');
    expect(prompt).toContain('so it is not logged');
  });

  it('gives every run of one room type the same protocol text', () => {
    expect(workspace_protocol(2, 'narrow')).toBe(workspace_protocol(2, 'narrow'));
    expect(workspace_protocol(2, 'narrow')).not.toBe(workspace_protocol(2, 'workspace'));
  });
});

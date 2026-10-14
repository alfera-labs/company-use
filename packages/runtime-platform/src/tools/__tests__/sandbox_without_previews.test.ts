import type { SessionEnv } from '@agent-core/environment';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

async function tool_names_offered_in(environment: SessionEnv | undefined) {
  const db = await create_test_database();
  return create_runtime_tool_definitions(db, {
    workspace_id: 'ws_test',
    session_id: 'ses_test',
    run_id: 'run_test',
    ...(environment ? { environment } : {}),
    actor_id: 'usr_test',
  }).map((tool) => tool.tool_name);
}

const docker_sandbox: SessionEnv = {
  env_key: 'docker:test',
  env_kind: 'custom',
  working_directory: '/workspace',
  metadata: { environment_provider: 'docker' },
  exec: async () => ({ exit_code: 0, stdout: '', stderr: '' }),
};

describe('the tools of a sandbox that serves no preview and has no browser', () => {
  it('offers no preview tool and no browser tool on the Docker sandbox', async () => {
    const tool_names = await tool_names_offered_in(docker_sandbox);

    expect(tool_names).toContain('workspace-run_command');
    expect(tool_names).toContain('workspace-write_file');
    expect(tool_names).not.toContain('workspace-preview');
    expect(tool_names.filter((name) => name.includes('browser'))).toEqual([]);
  });

  it('keeps the preview tool on a sandbox that serves previews', async () => {
    const serves_previews: SessionEnv = {
      ...docker_sandbox,
      env_kind: 'remote_sandbox',
      start_preview: async (input) => ({ port: input.port, command: input.command, cwd: '.' }),
    };

    expect(await tool_names_offered_in(serves_previews)).toContain('workspace-preview');
  });

  it('keeps the preview tool before a sandbox is attached', async () => {
    expect(await tool_names_offered_in(undefined)).toContain('workspace-preview');
  });
});

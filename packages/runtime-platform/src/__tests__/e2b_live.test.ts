import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  create_run,
  create_session,
  find_sandbox_by_mount_key,
} from '@coworker/core/db/queries/sessions';
import { open_runtime_file } from '@runtime-platform/files/file_service';
import { proxy_e2b_preview_request } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  mark_coding_workspace_idle,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

const has_e2b_key = Boolean(process.env.E2B_API_KEY);

async function with_workspace_base<T>(test: (workspace_base_path: string) => Promise<T>) {
  const workspace_base_path = await mkdtemp(path.join(tmpdir(), 'coworker-e2b-live-'));
  try {
    return await test(workspace_base_path);
  } finally {
    await rm(workspace_base_path, { recursive: true, force: true });
  }
}

describe.runIf(has_e2b_key)('live e2b sandbox runtime', () => {
  it('opens a real sandbox, runs sandbox tools, persists rows, and reads files', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const db = await create_test_database();
      const bootstrap = await bootstrap_default_workspace(db);
      const session = await create_session(db, {
        workspace_id: bootstrap.workspace_id,
        agent_id: bootstrap.agent_id,
        session_title: 'Live E2B sandbox test',
        actor_id: bootstrap.user_id,
      });
      const run = await create_run(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        trigger_type: 'user_message',
        actor_id: bootstrap.user_id,
      });

      const workspace = await open_or_create_coding_workspace(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        run_id: run.run_id,
        provider: 'e2b',
        workspace_base_path,
        actor_id: bootstrap.user_id,
      });

      try {
        const provider_sandbox_id = workspace.environment.metadata?.provider_sandbox_id;
        expect(typeof provider_sandbox_id).toBe('string');
        expect(workspace.environment.metadata).toMatchObject({
          environment_provider: 'e2b',
          preview_port: 3000,
          preview_requires_proxy: true,
        });

        const sandbox = await find_sandbox_by_mount_key(db, {
          workspace_id: bootstrap.workspace_id,
          sandbox_provider: 'e2b',
          workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
        });
        expect(sandbox).toMatchObject({
          sandbox_status: 'running',
          provider_sandbox_id,
        });

        const tools = create_runtime_tool_definitions(db, {
          workspace_id: bootstrap.workspace_id,
          session_id: session.session_id,
          run_id: run.run_id,
          agent_id: bootstrap.agent_id,
          runtime_environment_id: workspace.runtime_environment_id,
          environment: workspace.environment,
          actor_id: bootstrap.user_id,
        });
        const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
        const context = {
          run_key: run.run_id,
          session_key: session.session_id,
          metadata: {},
        };

        await expect(
          tool_by_name
            .get('workspace-write_file')
            ?.execute?.({ path: '/work/artifacts/live.txt', content: 'hello live e2b' }, context),
        ).resolves.toMatchObject({ ok: true });
        await expect(
          tool_by_name
            .get('workspace-read_file')
            ?.execute?.({ path: 'artifacts/live.txt' }, context),
        ).resolves.toMatchObject({
          ok: true,
          content_text: 'hello live e2b',
        });
        await expect(
          tool_by_name.get('workspace-run_command')?.execute?.(
            {
              command: 'sh',
              args: ['-lc', 'printf "$COWORKER_WORKSPACE_ROOT:$HOME:$PWD"'],
            },
            context,
          ),
        ).resolves.toMatchObject({
          ok: true,
          content_text: '/work:/work:/work/repo',
        });
        const preview_port = 3210;
        const preview_script =
          "require('node:http').createServer((_, res) => res.end('hello live preview')).listen(3210, '0.0.0.0')";
        await expect(
          workspace.environment.start_preview?.({
            command: 'node',
            args: ['-e', preview_script],
            port: preview_port,
            timeout_ms: 30_000,
          }),
        ).resolves.toMatchObject({
          port: preview_port,
          process_id: expect.any(Number),
        });
        const preview_response = await proxy_e2b_preview_request({
          provider_sandbox_id: String(provider_sandbox_id),
          port: preview_port,
          path: '/',
          search: '',
          request: new Request('http://coworker.test/preview'),
          public_base_url: 'http://coworker.test/preview',
        });
        await expect(preview_response.text()).resolves.toBe('hello live preview');

        const files = await list_run_files(db, bootstrap.workspace_id, run.run_id);
        expect(files).toEqual([
          expect.objectContaining({
            file_purpose: 'file',
            storage_key: 'artifacts/live.txt',
            content_preview: 'hello live e2b',
            is_visible: true,
          }),
        ]);
        await expect(
          open_runtime_file(db, {
            workspace_id: bootstrap.workspace_id,
            file_id: files[0]?.file_id ?? '',
            actor_id: bootstrap.user_id,
          }),
        ).resolves.toMatchObject({
          missing: false,
          content_text: 'hello live e2b',
        });
      } finally {
        await mark_coding_workspace_idle(db, {
          workspace_id: bootstrap.workspace_id,
          runtime_environment_id: workspace.runtime_environment_id,
          close_token: workspace.close_token,
          actor_id: bootstrap.user_id,
        });
      }
    });
  }, 120_000);
});

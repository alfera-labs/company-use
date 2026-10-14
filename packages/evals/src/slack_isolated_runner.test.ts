import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connections } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { default_browser_profile_path } from '@coworker/evals/slack_eval_browser_defaults';
import { create_slack_fixture_manifest } from '@coworker/evals/slack_fixture_manifest';
import { run_slack_isolated_suite_with_database } from '@coworker/evals/slack_isolated_runner';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

const playwright_mocks = vi.hoisted(() => {
  const page = { close: vi.fn(async () => undefined) };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  return {
    page,
    context,
    open_context: vi.fn(async () => context),
    create_sender: vi.fn(({ team_id }: { team_id: string }) => ({
      get_user_id: async () => team_id.replace(/^T/u, 'U'),
      post_message: async () => undefined,
    })),
  };
});

vi.mock('@coworker/evals/slack_parallel_playwright_context', () => ({
  open_slack_parallel_playwright_context: playwright_mocks.open_context,
}));

vi.mock('@coworker/evals/slack_parallel_playwright_sender', () => ({
  create_slack_parallel_playwright_sender: playwright_mocks.create_sender,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isolated Slack eval runner', () => {
  it('uses one Playwright context with an independent page for each isolated task', async () => {
    const { db, manifest_path } = await create_ready_fixture_environment();

    await run_slack_isolated_suite_with_database(db, 'slack_operator', {
      fixture_manifest_path: manifest_path,
      task_id: 'connection_001',
      skip_judge: true,
      task_timeout_ms: 1,
      poll_interval_ms: 1,
      browser_headless: true,
    });

    expect(playwright_mocks.open_context).toHaveBeenCalledWith({
      user_data_directory: default_browser_profile_path,
      headless: true,
    });
    expect(playwright_mocks.context.newPage).toHaveBeenCalledTimes(1);
    expect(playwright_mocks.create_sender).toHaveBeenCalledWith({
      page: playwright_mocks.page,
      team_id: 'T0001',
      channel_id: 'C0001',
    });
    expect(playwright_mocks.page.close).toHaveBeenCalledTimes(1);
    expect(playwright_mocks.context.close).toHaveBeenCalledTimes(1);
  });

  it('keeps fifteen task executions active before grading', async () => {
    const { db, installer_by_task, manifest_path } = await create_ready_fixture_environment();
    let active_tasks = 0;
    let maximum_active_tasks = 0;
    const waiting_posts: Array<() => void> = [];
    let waiting_posts_released = false;

    const result = await run_slack_isolated_suite_with_database(db, 'slack_operator', {
      fixture_manifest_path: manifest_path,
      skip_judge: true,
      task_timeout_ms: 100,
      poll_interval_ms: 1,
      sender_factory: async (fixture) => ({
        get_user_id: async () => installer_by_task.get(fixture.task_id) as string,
        post_message: async () => {
          if (waiting_posts_released) return;
          await new Promise<void>((resolve) => {
            waiting_posts.push(resolve);
            if (waiting_posts.length < 15) return;
            waiting_posts_released = true;
            for (const release_post of waiting_posts) release_post();
          });
        },
      }),
      on_progress: (progress) => {
        if (progress.stage === 'sent') {
          active_tasks += 1;
          maximum_active_tasks = Math.max(maximum_active_tasks, active_tasks);
        }
        if (progress.stage === 'timeout') active_tasks -= 1;
      },
    });

    expect(result.task_results).toHaveLength(48);
    expect(maximum_active_tasks).toBe(15);
  });

  it('continues every task and scores a dispatch failure as zero', async () => {
    const { db, installer_by_task, manifest_path } = await create_ready_fixture_environment();
    let posted_task_count = 0;

    const result = await run_slack_isolated_suite_with_database(db, 'slack_operator', {
      fixture_manifest_path: manifest_path,
      skip_judge: true,
      task_timeout_ms: 25,
      poll_interval_ms: 1,
      sender_factory: async (fixture) => {
        if (fixture.task_id === 'connection_001') throw new Error('browser unavailable');
        return {
          get_user_id: async () => installer_by_task.get(fixture.task_id) as string,
          post_message: async () => {
            posted_task_count += 1;
          },
        };
      },
    });

    expect(posted_task_count).toBe(47);
    expect(result.task_results).toHaveLength(48);
    expect(result.average_execution_score).toBe(0);
    expect(result.task_results.find((task) => task.task_id === 'connection_001')).toMatchObject({
      status: 'error',
      failure_reason: 'slack_dispatch_failed',
      execution_score: 0,
      execution_issues: [
        {
          issue_type: 'dispatch_error',
          message: 'browser unavailable',
        },
      ],
    });
    expect(result.task_results.filter((task) => task.status === 'error')).toHaveLength(48);
    expect(result.task_results.find((task) => task.task_id === 'connection_002')).toMatchObject({
      status: 'error',
      failure_reason: 'slack_run_timeout',
      result_score: 0,
      speed_score: 0,
      tool_score: 0,
      execution_score: 0,
      execution_issues: [{ issue_type: 'timeout' }],
    });
    expect(
      result.task_results.find((task) => task.task_id === 'connection_002')?.duration_ms,
    ).toBeGreaterThan(0);
  });
});

async function create_ready_fixture_environment() {
  const db = await create_test_database();
  const tasks = await load_eval_tasks('slack_operator');
  const manifest = create_slack_fixture_manifest(
    'slack_operator',
    tasks.map((task) => task.task_id),
    'fixtures@example.com',
  );
  const installer_by_task = new Map<string, string>();

  for (const [index, fixture] of manifest.fixtures.entries()) {
    const identity = await provision_workspace_for_identity(db, {
      provider_key: 'eval_fixture',
      provider_user_id: fixture.product_identity_key,
      organization_id: fixture.product_identity_key,
      membership_id: fixture.product_identity_key,
      email: fixture.account_email,
      first_name: 'Robin',
      last_name: 'Vale',
    });
    const installer_user_id = `U${String(index + 1).padStart(4, '0')}`;
    const team_id = `T${String(index + 1).padStart(4, '0')}`;
    const channel_id = `C${String(index + 1).padStart(4, '0')}`;
    installer_by_task.set(fixture.task_id, installer_user_id);
    await db.insert(connections).values({
      connection_id: `conn_isolated_${index + 1}`,
      workspace_id: identity.workspace_id,
      app_id: 'app_eval_slack',
      connection_key: `native:slack:${team_id}`,
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack_workspace_bot',
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: team_id,
      authorized_scopes: ['chat:write'],
      provider_account: {
        bot_user_id: `B${String(index + 1).padStart(4, '0')}`,
        authed_user: { id: installer_user_id },
      },
      created_by: identity.user_id,
      last_updated_by: identity.user_id,
    });
    manifest.fixtures[index] = {
      ...fixture,
      status: 'ready',
      product_user_id: identity.user_id,
      product_workspace_id: identity.workspace_id,
      slack_team_id: team_id,
      slack_channel_id: channel_id,
    };
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'slack-isolated-eval-'));
  const manifest_path = path.join(directory, 'fixtures.yaml');
  await writeFile(manifest_path, stringify(manifest));
  return { db, installer_by_task, manifest_path };
}

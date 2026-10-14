import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { run_slack_live_suite_with_database } from '@coworker/evals/slack_live_runner';
import {
  create_test_sender,
  insert_slack_test_connection,
} from '@coworker/evals/slack_live_test_fixture';
import { describe, expect, it } from 'vitest';

describe('Slack live task concurrency', () => {
  it('keeps five task slots active while serializing Slack composer writes', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_test_connection(db, bootstrap);
    let active_tasks = 0;
    let maximum_active_tasks = 0;
    let active_posts = 0;
    let maximum_active_posts = 0;
    const sender = create_test_sender(async () => {
      active_posts += 1;
      maximum_active_posts = Math.max(maximum_active_posts, active_posts);
      await sleep(5);
      active_posts -= 1;
    });

    const result = await run_slack_live_suite_with_database(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      channel_id: 'CEVALS123',
      since: new Date(),
      skip_judge: true,
      sender,
      task_timeout_ms: 250,
      poll_interval_ms: 1,
      on_progress: (progress) => {
        if (progress.stage === 'sent') {
          active_tasks += 1;
          maximum_active_tasks = Math.max(maximum_active_tasks, active_tasks);
        }
        if (progress.stage === 'timeout') active_tasks -= 1;
      },
    });

    expect(result.task_results).toHaveLength(48);
    expect(maximum_active_tasks).toBe(5);
    expect(maximum_active_posts).toBe(1);
  });
});

async function sleep(duration_ms: number) {
  await new Promise((resolve) => setTimeout(resolve, duration_ms));
}

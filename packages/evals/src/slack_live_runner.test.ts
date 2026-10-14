import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  run_slack_live_suite_with_database,
  type SlackLiveProgress,
} from '@coworker/evals/slack_live_runner';
import {
  create_completed_slack_test_run,
  create_test_sender,
  insert_slack_test_connection,
  load_slack_test_task,
} from '@coworker/evals/slack_live_test_fixture';
import { describe, expect, it } from 'vitest';

describe('run_slack_live_suite_with_database', () => {
  it('posts as the installer, waits for the real run, grades it, and resumes without reposting', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const task = await load_slack_test_task('connection_002');
    await insert_slack_test_connection(db, bootstrap);
    const sent_messages: string[] = [];
    const progress: SlackLiveProgress[] = [];
    const sender = create_test_sender(async (text) => {
      sent_messages.push(text);
      await create_completed_slack_test_run(db, bootstrap, task);
    });
    const options = {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      channel_id: 'CEVALS123',
      task_id: task.task_id,
      since: new Date(0),
      skip_judge: true,
      sender,
      poll_interval_ms: 1,
      on_progress: (event: SlackLiveProgress) => progress.push(event),
    };

    const first = await run_slack_live_suite_with_database(db, 'slack_operator', options);
    const resumed = await run_slack_live_suite_with_database(db, 'slack_operator', {
      ...options,
      sender: create_test_sender(async () => {
        throw new Error('completed tasks must not be posted again');
      }),
    });

    expect(sent_messages).toEqual([task.prompt]);
    expect(progress.map((event) => event.stage)).toContain('completed');
    expect(progress.map((event) => event.stage)).toContain('existing');
    expect(first.task_results).toMatchObject([{ task_id: task.task_id, status: 'pass' }]);
    expect(resumed.task_results).toMatchObject([{ task_id: task.task_id, status: 'pass' }]);
  });

  it('rejects a browser session that belongs to a different Slack user', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await insert_slack_test_connection(db, bootstrap);

    await expect(
      run_slack_live_suite_with_database(db, 'slack_operator', {
        workspace_id: bootstrap.workspace_id,
        actor_email: 'fixtures@example.com',
        channel_id: 'CEVALS123',
        task_id: 'connection_002',
        sender: { get_user_id: async () => 'U_WRONG', post_message: async () => {} },
      }),
    ).rejects.toThrow('expected installer U_SENDER');
  });
});

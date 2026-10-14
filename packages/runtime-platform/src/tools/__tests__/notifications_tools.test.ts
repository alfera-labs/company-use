import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import {
  list_notifications_tool,
  write_notification_tool,
} from '@runtime-platform/tools/definitions/notifications';
import { find_tool_by_node_key } from '@runtime-platform/tools/tool_registry';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Db = Awaited<ReturnType<typeof create_test_database>>;
let db: Db;
let context: RuntimeToolExecutionContext;

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  context = {
    db,
    workspace_id: bootstrap.workspace_id,
    session_id: 'ses_1',
    run_id: 'run_1',
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  };
});

const a_notification = {
  subject: 'thread_17bb03',
  claim: 'asked for a refund',
  title: 'Sam asked about invoice 1042',
  body: 'Sam changed the plan and the invoice needs redoing.',
  urgency: 'routine' as const,
  score: 90,
  reason: 'a customer changed a paid plan',
  evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
};

describe('the notifications tools', () => {
  beforeAll(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-15T12:00:00Z') }));
  afterAll(() => vi.useRealTimers());

  it('are reachable by their node keys', () => {
    expect(find_tool_by_node_key('notifications-write_notification-1')).toBe(
      write_notification_tool,
    );
    expect(find_tool_by_node_key('notifications-list_notifications-1')).toBe(
      list_notifications_tool,
    );
  });

  it('writes a notification, says what happened to it, and reads it back', async () => {
    const written = await write_notification_tool.execute(a_notification, context);
    expect(written).toMatchObject({
      success: true,
      data: { outcome: 'notify_now', delivered_on: null },
    });

    const listed = await list_notifications_tool.execute({ days: 7, limit: 20 }, context);
    expect(listed).toMatchObject({
      success: true,
      data: {
        count: 1,
        notifications: [{ title: 'Sam asked about invoice 1042', outcome: 'notify_now' }],
      },
    });
  });

  it('stamps the automation the run belongs to, even when the model does not name it', async () => {
    const written = await write_notification_tool.execute(a_notification, {
      ...context,
      source_context: { source_metadata: { automation_id: 'atm_billing' } },
    });
    expect(written.success).toBe(true);

    const [row] = await read_notifications();
    expect(row?.notification.automation_id).toBe('atm_billing');
    expect(row?.notification.run_id).toBe('run_1');
    expect(row?.notification.session_id).toBe('ses_1');
  });

  it('keeps the automation the model named', async () => {
    await write_notification_tool.execute(
      { ...a_notification, automation_id: 'atm_named' },
      { ...context, source_context: { source_metadata: { automation_id: 'atm_billing' } } },
    );
    const [row] = await read_notifications();
    expect(row?.notification.automation_id).toBe('atm_named');
  });

  it('refuses a notification that stands on nothing, in words the model can act on', async () => {
    const refused = await write_notification_tool.execute(
      {
        ...a_notification,
        evidence: { event_ids: [], brain_slugs: [], run_ids: [], message_refs: [] },
      },
      context,
    );
    expect(refused).toMatchObject({
      success: false,
      error: { code: 'notification_invalid' },
    });
    expect((refused as { error: { message: string } }).error.message).toContain('evidence');
  });
});

async function read_notifications() {
  const page = await list_notifications_page(db, {
    workspace_id: context.workspace_id,
    page: 1,
    page_size: 100,
  });
  return page.items;
}

describe('what a run is told about writing a notification', () => {
  it('tells the run to write for the person, never ids or scores', () => {
    expect(write_notification_tool.description).toContain(
      'never include ids, session references, scores',
    );
  });
});

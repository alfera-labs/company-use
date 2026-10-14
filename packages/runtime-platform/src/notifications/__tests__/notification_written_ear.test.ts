import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import { write_notification } from '@runtime-platform/notifications/write_notification';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_trigger_node_keys,
  seed_native_trigger_catalog,
} from '@runtime-platform/tools/native_trigger_seed';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

describe('a written notification as an automation ear', () => {
  it('fires the automation whose conditions matches, and no other', async () => {
    const fixture = await create_fixture();

    await write_the_notification(fixture, 'deadline');

    const fires = await read_trigger_fires(fixture.db, fixture.workspace_id);
    expect(fires.map((fire) => fire.event_body?.trigger_id)).toEqual([fixture.invoice_trigger_id]);
    expect(fires[0]?.event_body?.delivery?.data).toMatchObject({
      title: 'Invoice 2211 is due on Friday',
      urgency: 'deadline',
      outcome: 'add_to_daily_summary',
      subject: 'invoice:2211',
      automation_id: fixture.noticing_automation_id,
    });
  });

  it('says nothing when the conditions does not match', async () => {
    const fixture = await create_fixture();

    await write_the_notification(fixture, 'fyi');

    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });

  it('never hands a notification only one person may read to anybody’s automation', async () => {
    const fixture = await create_fixture();

    await write_the_notification(fixture, 'deadline', true);

    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });

  it('never fires the automation that wrote the notification', async () => {
    const fixture = await create_fixture({ the_writer_also_listens: true });

    await write_the_notification(fixture, 'deadline');

    const fires = await read_trigger_fires(fixture.db, fixture.workspace_id);
    expect(fires.map((fire) => fire.event_body?.trigger_id)).toEqual([fixture.invoice_trigger_id]);
  });
});

function write_the_notification(
  fixture: Fixture,
  urgency: 'deadline' | 'fyi',
  only_the_principal_reads = false,
) {
  return write_notification(fixture.db, {
    only_the_principal_reads,
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.user_id,
    written_by: 'run',
    notification: {
      automation_id: fixture.noticing_automation_id,
      run_id: 'run_test_notification_ear',
      subject: 'invoice:2211',
      claim: 'is due on Friday',
      title: 'Invoice 2211 is due on Friday',
      body: 'The supplier sent invoice 2211, due Friday.',
      urgency,
      evidence: { message_refs: ['msg_1'] },
      score: 70,
      reason: 'the invoice names a date',
    },
  });
}

type TriggerFireBody = {
  trigger_id?: string;
  delivery?: { data?: Record<string, unknown> };
};

async function read_trigger_fires(db: Database, workspace_id: string) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.workspace_id, workspace_id), eq(events.event_type, 'trigger.fired')));
  return rows.map((row) => ({ ...row, event_body: row.event_body as TriggerFireBody }));
}

async function create_fixture({ the_writer_also_listens = false } = {}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await seed_native_trigger_catalog(db);

  const noticing = await make_automation(db, bootstrap, 'Watch the supplier mail');
  const preparing = await make_automation(db, bootstrap, 'Prepare the payment draft');
  const invoice_trigger = await make_notification_ear(db, bootstrap, preparing.automation_id);
  if (the_writer_also_listens) {
    await make_notification_ear(db, bootstrap, noticing.automation_id);
  }

  return {
    db,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    user_id: bootstrap.user_id,
    noticing_automation_id: noticing.automation_id,
    invoice_trigger_id: invoice_trigger.trigger_id,
  };
}

type Bootstrap = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

function make_automation(db: Database, bootstrap: Bootstrap, automation_name: string) {
  return create_automation(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_name,
    instruction: 'Do the thing.',
    conditions: [{ field: 'title', operation: 'is_absent' }],
    judge: null,
    actor_id: bootstrap.user_id,
  });
}

function make_notification_ear(db: Database, bootstrap: Bootstrap, automation_id: string) {
  return create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_id,
    trigger_name: 'When a deadline notification about invoices appears',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      event_source: { node_key: native_trigger_node_keys.notification_written },
      rules: [
        { field: 'urgency', operation: 'equals_any_of', values: ['deadline'] },
        { field: 'title', operation: 'contains_any_of', values: ['invoice'] },
      ],
    },
    trigger_status: 'enabled',
    actor_id: bootstrap.user_id,
  });
}

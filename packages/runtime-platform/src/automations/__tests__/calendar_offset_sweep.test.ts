import { apps, type Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import { create_id, id_prefixes } from '@coworker/shared';
import { sweep_calendar_offsets } from '@runtime-platform/automations/calendar_offset_sweep';
import type { ScoutCalendarEvent } from '@runtime-platform/scout/scout_calendar';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_trigger_node_keys,
  seed_native_trigger_catalog,
} from '@runtime-platform/tools/native_trigger_seed';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-09-16T10:00:00.000Z');
const kickoff: ScoutCalendarEvent = {
  when: '2026-09-16T10:20:00.000Z',
  ends: '2026-09-16T11:00:00.000Z',
  title: 'Acme renewal kickoff',
  app_name: 'googlecalendar',
  event_id: 'evt_kickoff',
  event: {
    id: 'evt_kickoff',
    summary: 'Acme renewal kickoff',
    start: { dateTime: '2026-09-16T10:20:00.000Z' },
    attendees: [{ email: 'customer@example.com' }],
  },
};
const far_away: ScoutCalendarEvent = {
  ...kickoff,
  when: '2026-09-16T18:00:00.000Z',
  ends: null,
  title: 'Dinner',
  event_id: 'evt_dinner',
  event: { id: 'evt_dinner', summary: 'Dinner', start: { dateTime: '2026-09-16T18:00:00.000Z' } },
};

describe('sweep_calendar_offsets', () => {
  it('fires once per event and offset, and never again for the same pair', async () => {
    const fixture = await create_fixture();

    const first = await run_sweep(fixture, [kickoff, far_away]);
    expect(first.fired).toEqual([
      { trigger_id: fixture.trigger_id, event_id: 'evt_kickoff', offset_minutes: -20 },
    ]);

    const second = await run_sweep(fixture, [kickoff, far_away]);
    expect(second.fired).toEqual([]);
    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(1);
  });

  it('counts "five minutes after" from the end of the call when the ear says so', async () => {
    const fixture = await create_fixture({
      subscription_config: { offset_minutes: 5, relative_to: 'end' },
    });
    expect((await run_sweep(fixture, [kickoff])).fired).toEqual([]);
    const later = await sweep_calendar_offsets(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      now: new Date('2026-09-16T11:05:00.000Z'),
      find_calendar: async () => ({ node_key: 'googlecalendar-find_event-1' }) as never,
      list_events: async () => [kickoff],
    });
    expect(later.fired).toEqual([
      { trigger_id: fixture.trigger_id, event_id: 'evt_kickoff', offset_minutes: 5 },
    ]);
  });

  it('says nothing about an event the ear did not ask about', async () => {
    const fixture = await create_fixture({
      conditions: [{ field: 'summary', operation: 'contains_any_of', values: ['invoice'] }],
    });

    const result = await run_sweep(fixture, [kickoff]);

    expect(result.fired).toEqual([]);
    expect(result.silent).toEqual([
      { trigger_id: fixture.trigger_id, event_id: 'evt_kickoff', reason: expect.any(String) },
    ]);
    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });

  it('skips the whole sweep with a reason when no calendar is connected', async () => {
    const fixture = await create_fixture();

    const result = await sweep_calendar_offsets(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      now,
      find_calendar: async () => null,
      list_events: async () => {
        throw new Error('the sweep must not read a calendar nobody connected');
      },
    });

    expect(result).toMatchObject({ ran: false, code: 'no_calendar_connection', ears: 1 });
  });

  it('skips the sweep with a reason when the calendar could not be read', async () => {
    const fixture = await create_fixture();

    const result = await sweep_calendar_offsets(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      now,
      find_calendar: async () => ({ node_key: 'googlecalendar-find_event-1' }) as never,
      list_events: async () => null,
    });

    expect(result).toMatchObject({ ran: false, code: 'calendar_read_failed', ears: 1 });
  });

  it('still fires a reminder that came due 45 minutes ago, when earlier sweeps missed it', async () => {
    const fixture = await create_fixture();

    const result = await sweep_calendar_offsets(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      now: new Date('2026-09-16T10:45:00.000Z'),
      find_calendar: async () => ({ node_key: 'googlecalendar-find_event-1' }) as never,
      list_events: async () => [kickoff],
    });

    expect(result.fired).toEqual([
      { trigger_id: fixture.trigger_id, event_id: 'evt_kickoff', offset_minutes: -20 },
    ]);
  });

  it('keys the fire on the event id, so the same event continues its own conversation', async () => {
    const fixture = await create_fixture();

    await run_sweep(fixture, [kickoff]);

    const [fire] = await read_trigger_fires(fixture.db, fixture.workspace_id);
    expect(fire?.queue_key).toBe(`automation:${fixture.automation_id}:subject:evt_kickoff`);
    expect(
      (fire?.event_body as { delivery: { data: Record<string, unknown> } }).delivery.data,
    ).toMatchObject({ event_id: 'evt_kickoff', summary: 'Acme renewal kickoff' });
  });

  it('seeds the offset node onto a calendar app that exists, and onto none that does not', async () => {
    const fixture = await create_fixture();

    const seeded = await fixture.db.query.nodes.findFirst({
      where: (table, { eq: is }) =>
        is(table.node_key, native_trigger_node_keys.google_calendar_event_offset),
    });
    const outlook = await fixture.db.query.nodes.findFirst({
      where: (table, { eq: is }) =>
        is(table.node_key, native_trigger_node_keys.outlook_calendar_event_offset),
    });

    expect(seeded?.node_config.subject_field).toBe('event_id');
    expect(seeded?.input_schema.required).toEqual(['offset_minutes']);
    expect(outlook).toBeUndefined();
  });
});

function run_sweep(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  calendar: ScoutCalendarEvent[],
) {
  return sweep_calendar_offsets(fixture.db, {
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    now,
    find_calendar: async () => ({ node_key: 'googlecalendar-find_event-1' }) as never,
    list_events: async () => calendar,
  });
}

async function read_trigger_fires(db: Database, workspace_id: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.workspace_id, workspace_id), eq(events.event_type, 'trigger.fired')));
}

async function create_fixture(
  options: { conditions?: TriggerRule[]; subscription_config?: Record<string, unknown> } = {},
) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await create_google_calendar_app(db);
  await seed_native_trigger_catalog(db);

  const automation = await create_automation(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_name: 'Before the kickoff',
    instruction: 'Pull the notes together before the meeting starts.',
    run_policy: { subject_from: null, when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [{ field: 'event_id', operation: 'is_absent' }],
    judge: null,
    actor_id: bootstrap.user_id,
  });
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_id: automation.automation_id,
    trigger_name: 'Before or after an event',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      event_source: {
        node_key: native_trigger_node_keys.google_calendar_event_offset,
        subscription_config: options.subscription_config ?? { offset_minutes: -20 },
      },
      ...(options.conditions ? { rules: options.conditions } : {}),
    },
    trigger_status: 'enabled',
    actor_id: bootstrap.user_id,
  });

  return {
    db,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_id: automation.automation_id,
    trigger_id: trigger.trigger_id,
  };
}

async function create_google_calendar_app(db: Database) {
  await db.insert(apps).values({
    app_id: create_id(id_prefixes.app),
    app_name: 'google_calendar_v2',
    app_key: 'google_calendar_v2',
    catalog_scope: 'global',
    app_display_name: 'Google Calendar',
    app_category: 'productivity',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {
      source: 'composio',
      sourced_from: { provider: 'composio', provider_app_slug: 'googlecalendar' },
    },
    created_by: 'test',
    last_updated_by: 'test',
  });
}

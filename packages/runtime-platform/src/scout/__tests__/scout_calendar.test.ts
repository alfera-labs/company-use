import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { scout_actor } from '@coworker/shared';
import {
  list_upcoming_calendar_events,
  type RunCatalogTool,
} from '@runtime-platform/scout/scout_calendar';
import { describe, expect, it, vi } from 'vitest';

const now = new Date('2026-09-16T09:00:00.000Z');

type Db = Awaited<ReturnType<typeof create_test_database>>;

describe('list_upcoming_calendar_events', () => {
  it('finds a calendar whose app name differs by environment, through its toolkit slug', async () => {
    const db = await create_test_database();
    const workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
    await connect_calendar(db, workspace_id, 'google_calendar_v2', 'googlecalendar');
    const run_catalog_tool = vi.fn(async () => ({
      success: true as const,
      data: {
        items: [{ id: 'evt_1', start: { dateTime: '2026-09-18T13:00:00Z' }, summary: 'Renewal' }],
      },
    })) as unknown as RunCatalogTool;

    const events = await list_upcoming_calendar_events(db, {
      workspace_id,
      session_id: 'ses_scout',
      now,
      run_catalog_tool,
    });

    expect(events?.map((event) => event.title)).toEqual(['Renewal']);
    expect(vi.mocked(run_catalog_tool).mock.calls[0]?.[1]).toMatchObject({
      node_key: 'google_calendar_v2-find_event-1',
    });
  });

  it('reads the next seven days through the catalog node when a calendar is connected', async () => {
    const db = await create_test_database();
    const workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
    await connect_calendar(db, workspace_id, 'googlecalendar');
    const run_catalog_tool = vi.fn(async () => ({
      success: true as const,
      data: {
        items: [
          {
            id: 'evt_1',
            start: { dateTime: '2026-09-18T13:00:00Z' },
            summary: 'Renewal with Sam',
          },
          { start: { date: '2026-09-20' }, summary: 'Kickoff, Acme' },
          { start: { dateTime: '2026-09-21T09:00:00Z' } },
        ],
      },
    })) as unknown as RunCatalogTool;

    const events = await list_upcoming_calendar_events(db, {
      workspace_id,
      session_id: 'ses_scout',
      now,
      run_catalog_tool,
    });

    expect(events).toEqual([
      {
        when: '2026-09-18T13:00:00Z',
        ends: null,
        title: 'Renewal with Sam',
        app_name: 'googlecalendar',
        event_id: 'evt_1',
        event: expect.objectContaining({ summary: 'Renewal with Sam' }),
      },
      {
        when: '2026-09-20',
        ends: null,
        title: 'Kickoff, Acme',
        app_name: 'googlecalendar',
        event_id: null,
        event: expect.objectContaining({ summary: 'Kickoff, Acme' }),
      },
    ]);
    const call = vi.mocked(run_catalog_tool).mock.calls[0]?.[1];
    expect(call).toMatchObject({
      node_key: 'googlecalendar-find_event-1',
      actor_id: scout_actor,
      tool_input: { timeMin: now.toISOString(), timeMax: '2026-09-23T09:00:00.000Z' },
    });
  });

  it('asks nobody anything when no calendar is connected', async () => {
    const db = await create_test_database();
    const workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
    const run_catalog_tool = vi.fn() as unknown as RunCatalogTool;

    const events = await list_upcoming_calendar_events(db, {
      workspace_id,
      session_id: 'ses_scout',
      now,
      run_catalog_tool,
    });

    expect(events).toEqual([]);
    expect(run_catalog_tool).not.toHaveBeenCalled();
  });

  it('says the calendar could not be read, instead of saying it is empty', async () => {
    const db = await create_test_database();
    const workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
    await connect_calendar(db, workspace_id, 'googlecalendar');
    const run_catalog_tool = vi.fn(async () => ({
      success: false as const,
      error: { code: 'connection_expired', message: 'Reconnect Google Calendar.' },
    })) as unknown as RunCatalogTool;

    const events = await list_upcoming_calendar_events(db, {
      workspace_id,
      session_id: 'ses_scout',
      now,
      run_catalog_tool,
    });

    expect(events).toBeNull();
  });

  it('never hands the scout more events than the cap', async () => {
    const db = await create_test_database();
    const workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
    await connect_calendar(db, workspace_id, 'googlecalendar');
    const run_catalog_tool = vi.fn(async () => ({
      success: true as const,
      data: {
        items: Array.from({ length: 50 }, (_unused, index) => ({
          start: { dateTime: '2026-09-18T13:00:00Z' },
          summary: `Event ${index}`,
        })),
      },
    })) as unknown as RunCatalogTool;

    const events = await list_upcoming_calendar_events(db, {
      workspace_id,
      session_id: 'ses_scout',
      now,
      limit: 5,
      run_catalog_tool,
    });

    expect(events).toHaveLength(5);
  });
});

async function connect_calendar(
  db: Db,
  workspace_id: string,
  app_name: string,
  toolkit_slug?: string,
) {
  const actor_id = 'system:test';
  await db.insert(apps).values({
    app_id: `app_${app_name}`,
    app_name,
    app_key: app_name,
    catalog_scope: 'global',
    app_display_name: 'Google Calendar',
    auth_type: 'oauth2',
    app_status: 'active',
    metadata: toolkit_slug
      ? {
          source: 'composio',
          sourced_from: { provider: 'composio', provider_app_slug: toolkit_slug },
        }
      : {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(nodes).values({
    node_id: `node_${app_name}_find_event`,
    app_id: `app_${app_name}`,
    app_key: app_name,
    node_name: 'find_event',
    catalog_scope: 'global',
    node_key: `${app_name}-find_event-1`,
    node_version: 1,
    node_display_name: 'Find event',
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    runtime_handler: 'composio.tool',
    node_runtime: 'connected_app',
    provider_key: 'composio',
    provider_config_key: `composio:${app_name}`,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(connections).values({
    connection_id: 'con_calendar',
    workspace_id,
    app_id: `app_${app_name}`,
    connection_name: 'Google Calendar',
    connection_key: `composio:${app_name}`,
    connection_status: 'active',
    provider_key: 'composio',
    provider_config_key: `composio:${app_name}`,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

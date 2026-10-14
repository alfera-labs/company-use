import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { event_jobs, workspaces } from '@coworker/core/db/schema';
import { claim_ready_event_jobs_for_queue, list_events_for_event_jobs } from '@coworker/jobs';
import { date_to_slack_ts } from '@runtime-platform/channels/slack/discovery_checkpoint';
import type { SlackHistoryMessage } from '@runtime-platform/channels/slack/history';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const slack_history = vi.hoisted(() => ({
  find_workspace_slack_connection: vi.fn(
    async (_db: unknown, _workspace_id: string, connection_id?: string) => ({
      connection_id: connection_id ?? 'conn_1',
      credentials: { bot_token: 'slack-discovery-test-token' },
      external_account_id: 'T1',
    }),
  ),
  list_all_workspace_slack_channels: vi.fn(async () => [
    { channel_id: 'C1', channel_name: 'general', is_member: true },
    { channel_id: 'C2', channel_name: 'random', is_member: true },
    { channel_id: 'C3', channel_name: 'not-joined', is_member: false },
  ]),
  fetch_slack_channel_history_page: vi.fn(
    async (_token: string, _input: Record<string, unknown>) => ({
      messages: [
        {
          message_ts: '1709283600.0001',
          user_id: 'U1',
          text: 'Acme sells running shoes.',
          thread_ts: null as string | null,
          subtype: null,
          file_names: [],
        },
      ],
      next_cursor: null as string | null,
    }),
  ),
  fetch_slack_thread_replies_page: vi.fn(
    async (_token: string, _input: Record<string, unknown>) => ({
      messages: [] as SlackHistoryMessage[],
      next_cursor: null as string | null,
    }),
  ),
}));

const channel_digest = vi.hoisted(() => ({
  summarize: vi.fn(
    async (_input: { channel_label: string; message_lines: string[] }) =>
      '• Team is launching the running-shoe line',
  ),
  summarize_inputs: [] as Array<{ channel_label: string; message_lines: string[] }>,
}));

const slack_directory = vi.hoisted(() => ({
  load_slack_user_directory: vi.fn(async () => ({
    members: [
      {
        user_id: 'U1',
        real_name: 'Morgan Example',
        display_name: 'Mo',
        email: 'morgan@example.com',
        is_bot: false,
      },
      { user_id: 'UBOT', real_name: 'Alfera Bot', display_name: null, email: null, is_bot: true },
    ],
    name_by_id: new Map([['U1', 'Morgan Example']]),
    truncated: false,
    loaded_pages: 1,
  })),
}));

vi.mock('@runtime-platform/channels/slack/history', () => ({
  find_workspace_slack_connection: slack_history.find_workspace_slack_connection,
  read_slack_bot_token: () => 'slack-discovery-test-token',
  list_all_workspace_slack_channels: slack_history.list_all_workspace_slack_channels,
  fetch_slack_channel_history_page: slack_history.fetch_slack_channel_history_page,
  fetch_slack_thread_replies_page: slack_history.fetch_slack_thread_replies_page,
}));

vi.mock('@runtime-platform/channels/slack/directory', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/channels/slack/directory')>();
  return {
    ...actual,
    load_slack_user_directory: slack_directory.load_slack_user_directory,
  };
});

vi.mock('@runtime-platform/discovery/channel_digest', () => ({
  make_channel_activity_summarizer: () => ({
    summarize: (input: { channel_label: string; message_lines: string[] }) => {
      channel_digest.summarize_inputs.push(input);
      return channel_digest.summarize(input);
    },
  }),
}));

import { run_slack_discovery_channel_job } from '@runtime-platform/events/slack_discovery_channel_job';
import { run_slack_discovery_job } from '@runtime-platform/events/slack_discovery_job';

const workspace_id = 'ws_alfera';

type DiscoveryEvent = Parameters<typeof run_slack_discovery_job>[0]['events'][number];

async function run_coordinator(
  db: Awaited<ReturnType<typeof create_test_database>>,
  events: DiscoveryEvent[] = [],
) {
  return run_slack_discovery_job({
    db,
    workspace_id,
    queue_key: `slack_discovery:${workspace_id}`,
    event_jobs: [],
    events,
    heartbeat: async () => undefined,
    run_queue_jobs_in_the_background: () => undefined,
  });
}

async function claim_channel_job(
  db: Awaited<ReturnType<typeof create_test_database>>,
  queue_key: string,
) {
  const claimed = await claim_ready_event_jobs_for_queue(db, {
    workspace_id,
    queue_key,
    worker_id: 'worker-1',
  });
  const events = await list_events_for_event_jobs(db, { workspace_id, event_jobs: claimed });
  return () =>
    run_slack_discovery_channel_job({
      db,
      workspace_id,
      queue_key,
      event_jobs: claimed,
      events,
      heartbeat: async () => undefined,
    });
}

async function run_channel_job(
  db: Awaited<ReturnType<typeof create_test_database>>,
  queue_key: string,
) {
  return (await claim_channel_job(db, queue_key))();
}

describe('slack discovery handlers', () => {
  beforeEach(() => {
    slack_history.find_workspace_slack_connection.mockClear();
    slack_history.list_all_workspace_slack_channels.mockClear();
    slack_history.fetch_slack_channel_history_page.mockClear();
    slack_history.fetch_slack_thread_replies_page.mockReset();
    slack_history.fetch_slack_thread_replies_page.mockResolvedValue({
      messages: [],
      next_cursor: null,
    });
    slack_directory.load_slack_user_directory.mockClear();
    channel_digest.summarize.mockClear();
    channel_digest.summarize_inputs = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coordinator fans out one discovery job per member channel and counts the team', async () => {
    const db = await create_test_database();

    const result = await run_coordinator(db);

    expect(result.job_status).toBe('done');
    expect(result.result_data?.channels_enqueued).toBe(2);
    expect(result.result_data?.member_count).toBe(1);
    const channel_jobs = await db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.workspace_id, workspace_id),
        eq(event_jobs.job_handler, 'slack_discovery_channel'),
      ),
    });
    expect(channel_jobs).toHaveLength(2);
  });

  it('coordinator skips Slack channels the bot is not a member of', async () => {
    const db = await create_test_database();

    await run_coordinator(db);

    const channel_events = (await db.query.events.findMany()).filter(
      (event) => event.event_type === 'slack.discover_channel',
    );
    expect(channel_events.map((event) => event.event_body)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ channel_id: 'C3' })]),
    );
  });

  it('coordinator queues the recap behind the channel jobs with their subject keys', async () => {
    const db = await create_test_database();

    await run_coordinator(db, [
      { event_body: { connection_id: 'conn_1', discovery_run_key: 'first-contact' } },
    ] as DiscoveryEvent[]);

    const summary_event = (await db.query.events.findMany()).find(
      (event) => event.event_type === 'slack.discovery_summary',
    );
    expect(summary_event?.event_body).toMatchObject({
      member_count: 1,
      channel_subject_keys: [
        'slack_discovery_channel:first-contact:C1',
        'slack_discovery_channel:first-contact:C2',
      ],
    });
  });

  it('channel job reads a 90-day window, then resumes from its checkpoint', async () => {
    vi.useFakeTimers();
    const first_scan_time = new Date('2026-06-28T00:00:00.000Z');
    const second_scan_time = new Date('2026-07-05T00:00:00.000Z');
    vi.setSystemTime(first_scan_time);

    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const scan_channel = await claim_channel_job(db, 'slack_discovery_channel:C1');
    await scan_channel();

    const backfill_start = new Date(first_scan_time.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(slack_history.fetch_slack_channel_history_page).toHaveBeenLastCalledWith(
      'slack-discovery-test-token',
      expect.objectContaining({
        channel_id: 'C1',
        oldest: date_to_slack_ts(backfill_start),
        latest: date_to_slack_ts(first_scan_time),
        inclusive: true,
      }),
    );

    vi.setSystemTime(second_scan_time);
    await scan_channel();

    expect(slack_history.fetch_slack_channel_history_page).toHaveBeenLastCalledWith(
      'slack-discovery-test-token',
      expect.objectContaining({
        channel_id: 'C1',
        oldest: date_to_slack_ts(first_scan_time),
        latest: date_to_slack_ts(second_scan_time),
        inclusive: true,
      }),
    );
  });

  it('channel job carries its digest and its window in its own result', async () => {
    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const result = await run_channel_job(db, 'slack_discovery_channel:C1');

    expect(result.job_status).toBe('done');
    expect(result.result_data).toMatchObject({
      channel_id: 'C1',
      channel_label: '#general',
      messages_scanned: 1,
      digest_text: '• Team is launching the running-shoe line',
      scan_truncated: false,
    });
    expect(result.result_data?.discovery_oldest_ts).toEqual(expect.any(String));
    expect(channel_digest.summarize_inputs[0]).toMatchObject({
      channel_label: '#general',
      message_lines: ['Fri 2024-03-01 @Morgan Example: Acme sells running shoes.'],
    });
  });

  it('a channel with nothing to summarize reports no digest instead of failing', async () => {
    slack_history.fetch_slack_channel_history_page.mockResolvedValueOnce({
      messages: [],
      next_cursor: null,
    });

    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const result = await run_channel_job(db, 'slack_discovery_channel:C1');

    expect(result.job_status).toBe('done');
    expect(result.result_data?.digest_text).toBeNull();
    expect(channel_digest.summarize).not.toHaveBeenCalled();
  });

  it('channel job stops at the per-run message cap and reports the truncation', async () => {
    let next_ts = 1_709_283_600;
    const endless_page = async (_token: string, input: Record<string, unknown>) => ({
      messages: Array.from({ length: Number(input.limit ?? 200) }, () => ({
        message_ts: `${next_ts++}.0001`,
        user_id: 'U1',
        text: 'endless chatter',
        thread_ts: null,
        subtype: null,
        file_names: [],
      })),
      next_cursor: 'more',
    });
    for (let page = 0; page < 6; page++) {
      slack_history.fetch_slack_channel_history_page.mockImplementationOnce(endless_page);
    }

    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const result = await run_channel_job(db, 'slack_discovery_channel:C1');

    expect(result.job_status).toBe('done');
    expect(result.result_data?.messages_scanned).toBe(999);
    expect(result.result_data?.scan_truncated).toBe(true);
    expect(slack_history.fetch_slack_channel_history_page).toHaveBeenCalledTimes(5);
  });

  it('channel job reads whole threads into the digest sample', async () => {
    slack_history.fetch_slack_channel_history_page.mockImplementationOnce(async () => ({
      messages: [
        {
          message_ts: '1709283600.0001',
          user_id: 'U1',
          text: 'Incident thread: checkout is down.',
          thread_ts: '1709283600.0001',
          subtype: null,
          file_names: [],
        },
      ],
      next_cursor: null,
    }));
    slack_history.fetch_slack_thread_replies_page.mockResolvedValue({
      messages: [
        {
          message_ts: '1709283600.0001',
          user_id: 'U1',
          text: 'Incident thread: checkout is down.',
          thread_ts: '1709283600.0001',
          subtype: null,
          file_names: [],
        },
        {
          message_ts: '1709283700.0002',
          user_id: 'U1',
          text: 'We are rolling back the payment change.',
          thread_ts: '1709283600.0001',
          subtype: null,
          file_names: [],
        },
      ],
      next_cursor: null,
    });

    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const result = await run_channel_job(db, 'slack_discovery_channel:C1');

    expect(result.job_status).toBe('done');
    expect(result.result_data?.threads_scanned).toBe(1);
    expect(slack_history.fetch_slack_thread_replies_page).toHaveBeenCalledWith(
      'slack-discovery-test-token',
      expect.objectContaining({ channel_id: 'C1', thread_ts: '1709283600.0001', limit: 200 }),
    );
    expect(channel_digest.summarize_inputs[0]?.message_lines).toContain(
      'Fri 2024-03-01 @Morgan Example: We are rolling back the payment change.',
    );
  });

  it('a parent-only thread is not counted or re-read', async () => {
    slack_history.fetch_slack_channel_history_page.mockImplementationOnce(async () => ({
      messages: [
        {
          message_ts: '1709283600.0001',
          user_id: 'U1',
          text: 'Lonely parent.',
          thread_ts: '1709283600.0001',
          subtype: null,
          file_names: [],
        },
      ],
      next_cursor: null,
    }));
    slack_history.fetch_slack_thread_replies_page.mockResolvedValue({
      messages: [
        {
          message_ts: '1709283600.0001',
          user_id: 'U1',
          text: 'Lonely parent.',
          thread_ts: '1709283600.0001',
          subtype: null,
          file_names: [],
        },
      ],
      next_cursor: null,
    });

    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const result = await run_channel_job(db, 'slack_discovery_channel:C1');

    expect(result.result_data?.threads_scanned).toBe(0);
  });

  it('a model failure costs the channel its digest, not its scan', async () => {
    channel_digest.summarize.mockRejectedValueOnce(new Error('gateway is down'));

    const db = await create_test_database();
    await insert_workspace(db);
    await run_coordinator(db);

    const result = await run_channel_job(db, 'slack_discovery_channel:C1');

    expect(result.job_status).toBe('done');
    expect(result.result_data?.messages_scanned).toBe(1);
    expect(result.result_data?.digest_text).toBeNull();
  });
});

async function insert_workspace(db: Awaited<ReturnType<typeof create_test_database>>) {
  await db.insert(workspaces).values({
    workspace_id,
    workspace_name: 'Alfera',
    workspace_slug: 'alfera',
    created_by: 'test',
    last_updated_by: 'test',
  });
}

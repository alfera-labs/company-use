import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { connections, event_jobs } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_posts: Array<{ channel: string; text: string }> = [];
const slack_post_options: unknown[] = [];

const workflow_proposals = vi.hoisted(() => ({
  write: vi.fn(async (_input: unknown) => [] as unknown[]),
  write_inputs: [] as unknown[],
}));

vi.mock('@runtime-platform/discovery/workflow_proposals', () => ({
  make_workflow_proposal_writer: () => ({
    write: (input: unknown) => {
      workflow_proposals.write_inputs.push(input);
      return workflow_proposals.write(input);
    },
  }),
}));

vi.mock('@runtime-platform/tools/slack/channels_api', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/tools/slack/channels_api')>();
  return {
    ...actual,
    post_slack_message: async (_token: string, channel: string, text: string, options: unknown) => {
      slack_posts.push({ channel, text });
      slack_post_options.push(options);
      return { ok: true };
    },
  };
});

import { run_slack_discovery_summary_job } from '@runtime-platform/events/slack_discovery_summary_job';
import { run_slack_workflow_proposal_job } from '@runtime-platform/events/slack_workflow_proposal_job';

const workspace_id = 'ws_alfera';

describe('slack discovery summary job', () => {
  beforeEach(() => {
    slack_posts.length = 0;
    slack_post_options.length = 0;
    workflow_proposals.write.mockReset();
    workflow_proposals.write.mockResolvedValue([]);
    workflow_proposals.write_inputs = [];
  });

  it('requeues while channel jobs are still running', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);
    const summary_event = await enqueue_summary_event(db, {
      channel_subject_keys: ['slack_discovery_channel:run_1:C1'],
    });
    await enqueue_event_jobs(db, {
      workspace_id,
      source: 'slack_discovery',
      source_event_id: 'run_1:channel:C1',
      event_type: 'slack.discover_channel',
      queue_key: 'slack_discovery_channel:run_1:C1',
      actor_key: 'system:discovery',
      event_jobs: [{ job_handler: 'slack_discovery_channel' }],
    });

    const result = await run_summary(db, summary_event.event);

    expect(result.job_status).toBe('done');
    expect(result.retry_at).toBeInstanceOf(Date);
    expect(result.result_data).toMatchObject({ pending_channel_jobs: 1 });
    expect(slack_posts).toHaveLength(0);
  }, 30_000);

  it('posts nothing itself once every channel job finishes, and hands over to the offers', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);
    const summary_event = await enqueue_summary_event(db, {
      channel_subject_keys: ['slack_discovery_channel:run:C1', 'slack_discovery_channel:run:C2'],
    });
    await seed_finished_channel_job(db, {
      channel_id: 'C1',
      queue_key: 'slack_discovery_channel:run:C1',
      messages_scanned: 12,
      digest_text: '• Sales compiles a fintech lead list by hand every Monday',
    });
    await seed_finished_channel_job(db, {
      channel_id: 'C2',
      queue_key: 'slack_discovery_channel:run:C2',
      messages_scanned: 8,
      digest_text: null,
    });

    const result = await run_summary(db, summary_event.event);

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: {
        channels_scanned: 2,
        messages_scanned: 20,
        channels_with_a_digest: 1,
        posted_to_slack: false,
      },
    });
    expect(slack_posts).toHaveLength(0);
  }, 30_000);

  it('a silent run posts nothing and proposes nothing', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);
    const summary_event = await enqueue_summary_event(db, {
      channel_subject_keys: [],
      delivery_mode: 'silent',
    });

    const result = await run_summary(db, summary_event.event);

    expect(result.result_data).toMatchObject({ delivery_mode: 'silent', posted_to_slack: false });
    expect(slack_posts).toHaveLength(0);
    const proposal_jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.job_handler, 'slack_workflow_proposal'),
    });
    expect(proposal_jobs).toHaveLength(0);
  }, 30_000);

  it('summary enqueues one proposal round carrying the channel subject keys', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);
    const summary_event = await enqueue_summary_event(db, {
      channel_subject_keys: ['slack_discovery_channel:run:C1'],
    });
    await seed_finished_channel_job(db, {
      channel_id: 'C1',
      queue_key: 'slack_discovery_channel:run:C1',
      messages_scanned: 3,
      digest_text: '• Something durable',
    });

    await run_summary(db, summary_event.event);

    const proposal_jobs = await db.query.event_jobs.findMany({
      where: eq(event_jobs.job_handler, 'slack_workflow_proposal'),
    });
    expect(proposal_jobs).toHaveLength(1);
    expect(proposal_jobs[0]?.job_status).toBe('queued');
    const proposal_event = (await db.query.events.findMany()).find(
      (event) => event.event_type === 'slack.workflow_proposals',
    );
    expect(proposal_event?.event_body).toMatchObject({
      notification_channel_id: 'C_SUPPORT',
      channel_subject_keys: ['slack_discovery_channel:run:C1'],
    });
  }, 30_000);

  it('proposal job plays the best job back as steps and never re-pitches the same job', async () => {
    workflow_proposals.write.mockResolvedValue([monday_report, quiet_renewals]);
    const db = await create_test_database();
    await seed_slack_connection(db);
    await seed_finished_channel_job(db, {
      channel_id: 'C1',
      queue_key: 'slack_discovery_channel:run_7:C1',
      messages_scanned: 40,
      digest_text: '• Alex builds the sales report by hand every Monday',
    });
    const proposal_event = await enqueue_proposal_event(db, 'run_7');

    const first = await run_proposals(db, proposal_event.event, 'run_7');

    expect(first.job_status).toBe('done');
    expect(first.result_data).toMatchObject({ proposals_created: 2, posted_to_slack: true });
    expect(slack_posts).toHaveLength(1);
    expect(slack_posts[0]?.channel).toBe('C_QA');
    expect(slack_post_options[0]).toEqual({
      idempotency_key: 'slack_workflow_proposals:ws_alfera:run_7',
      reconcile_before_post: true,
    });
    const text = slack_posts[0]?.text ?? '';
    expect(text).toContain("Two things I'd love to take off your plates");
    expect(text).toContain("**The Monday sales report.** Alex, if I've got it right:");
    expect(text).toContain('• pull the deals from HubSpot and the payouts from Stripe');
    expect(text).toContain('Did I miss a step?');
    expect(text).toContain('• chase the renewals that went quiet (Acme is one)');
    expect(text).toContain('connect HubSpot, Stripe and Google Sheets');
    expect(text).not.toContain('—');
    expect(text).not.toContain('set up #1');
    const first_input = workflow_proposals.write_inputs.at(0) as { source_lines: string[] };
    expect(first_input.source_lines).toEqual([
      '#C1:\n• Alex builds the sales report by hand every Monday',
    ]);

    await mark_proposal_job_done(db, first.result_data);
    await run_proposals(db, proposal_event.event, 'run_8');
    const second_input = workflow_proposals.write_inputs.at(-1) as {
      already_proposed_titles: string[];
    };
    expect(second_input.already_proposed_titles).toContain('The Monday sales report');
  }, 30_000);

  it('a first look that finds nothing says so and shows what it can take on', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);
    const proposal_event = await enqueue_proposal_event(db, 'first-contact');

    const result = await run_proposals(db, proposal_event.event, 'first-contact');

    expect(result.result_data).toMatchObject({ proposals_created: 0, posted_to_slack: true });
    expect(workflow_proposals.write).not.toHaveBeenCalled();
    const text = slack_posts[0]?.text ?? '';
    expect(text).toContain("Okay, I'm caught up. Nothing jumped out yet");
    expect(text).toContain(
      'Pretty much anything a person can do on a laptop, I can run on autopilot.',
    );
  }, 30_000);

  it('a later look that finds nothing stays silent', async () => {
    const db = await create_test_database();
    await seed_slack_connection(db);
    const proposal_event = await enqueue_proposal_event(db, 'run_9');

    const result = await run_proposals(db, proposal_event.event, 'run_9');

    expect(result.result_data).toMatchObject({ proposals_created: 0, posted_to_slack: false });
    expect(slack_posts).toHaveLength(0);
  }, 30_000);
});

const monday_report = {
  title: 'The Monday sales report',
  owner_first_name: 'Alex',
  steps: [
    'pull the deals from HubSpot and the payouts from Stripe',
    'add them to the Google Sheet',
    'post the summary in #sales',
  ],
  offer: 'I can do all of that, every Monday at 9.',
  short_offer: 'build the Monday sales report from HubSpot and Stripe',
  tool_names: ['HubSpot', 'Stripe', 'Google Sheets'],
};

const quiet_renewals = {
  title: 'Quiet renewals',
  owner_first_name: null,
  steps: ['spot the renewals with no reply in two weeks', 'draft the follow-up'],
  offer: 'I can keep on top of those every morning.',
  short_offer: 'chase the renewals that went quiet (Acme is one)',
  tool_names: ['HubSpot'],
};

async function enqueue_proposal_event(
  db: Awaited<ReturnType<typeof create_test_database>>,
  run_key: string,
) {
  return enqueue_event_jobs(db, {
    workspace_id,
    source: 'slack_discovery',
    source_event_id: `${run_key}:proposals`,
    event_type: 'slack.workflow_proposals',
    queue_key: `slack_workflow_proposal:ws_alfera:${run_key}`,
    actor_key: 'system:discovery',
    event_body: {
      workspace_id,
      connection_id: 'conn_slack',
      notification_channel_id: 'C_QA',
      discovery_run_key: run_key,
      channel_subject_keys: [`slack_discovery_channel:${run_key}:C1`],
    },
    event_jobs: [{ job_handler: 'slack_workflow_proposal' }],
  });
}

async function run_summary(
  db: Awaited<ReturnType<typeof create_test_database>>,
  event: { event_body: unknown },
) {
  return run_slack_discovery_summary_job({
    db,
    workspace_id,
    queue_key: 'slack_discovery:ws_alfera:run',
    event_jobs: [],
    events: [event as Parameters<typeof run_slack_discovery_summary_job>[0]['events'][number]],
    heartbeat: async () => undefined,
    run_queue_jobs_in_the_background: () => undefined,
  });
}

async function run_proposals(
  db: Awaited<ReturnType<typeof create_test_database>>,
  event: { event_body: unknown },
  run_key: string,
) {
  return run_slack_workflow_proposal_job({
    db,
    workspace_id,
    queue_key: `slack_workflow_proposal:ws_alfera:${run_key}`,
    event_jobs: [],
    events: [event as Parameters<typeof run_slack_workflow_proposal_job>[0]['events'][number]],
    heartbeat: async () => undefined,
  });
}

async function mark_proposal_job_done(
  db: Awaited<ReturnType<typeof create_test_database>>,
  result_data: Record<string, unknown> | undefined,
) {
  await db
    .update(event_jobs)
    .set({ job_status: 'done', result_data: result_data ?? {}, last_updated_by: 'test' })
    .where(
      and(
        eq(event_jobs.workspace_id, workspace_id),
        eq(event_jobs.job_handler, 'slack_workflow_proposal'),
      ),
    );
}

async function enqueue_summary_event(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: {
    channel_subject_keys: string[];
    delivery_mode?: 'silent' | 'slack';
    member_count?: number;
  },
) {
  return enqueue_event_jobs(db, {
    workspace_id,
    source: 'slack_discovery',
    source_event_id: `${input.channel_subject_keys[0] ?? 'none'}:summary`,
    event_type: 'slack.discovery_summary',
    queue_key: 'slack_discovery:ws_alfera:run',
    actor_key: 'system:discovery',
    event_body: {
      workspace_id,
      connection_id: 'conn_slack',
      delivery_mode: input.delivery_mode ?? 'slack',
      ...(input.delivery_mode === 'silent' ? {} : { notification_channel_id: 'C_SUPPORT' }),
      discovery_run_key: 'run',
      member_count: input.member_count ?? 0,
      channel_subject_keys: input.channel_subject_keys,
    },
    event_jobs: [{ job_handler: 'slack_discovery_summary' }],
  });
}

const scanned_window_start_ts = `${Math.floor(Date.UTC(2026, 5, 1) / 1000)}.000000`;

async function seed_finished_channel_job(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: {
    channel_id: string;
    queue_key: string;
    messages_scanned: number;
    digest_text: string | null;
  },
) {
  const enqueued = await enqueue_event_jobs(db, {
    workspace_id,
    source: 'slack_discovery',
    source_event_id: `${input.queue_key}:seed`,
    event_type: 'slack.discover_channel',
    queue_key: input.queue_key,
    actor_key: 'system:discovery',
    event_jobs: [{ job_handler: 'slack_discovery_channel' }],
  });
  await db
    .update(event_jobs)
    .set({
      job_status: 'done',
      result_data: {
        channel_id: input.channel_id,
        channel_label: `#${input.channel_id}`,
        messages_scanned: input.messages_scanned,
        digest_text: input.digest_text,
        discovery_oldest_ts: scanned_window_start_ts,
      },
      last_updated_by: 'test',
    })
    .where(
      and(
        eq(event_jobs.workspace_id, workspace_id),
        eq(event_jobs.job_id, enqueued.event_jobs[0]?.job_id ?? ''),
      ),
    );
}

async function seed_slack_connection(db: Awaited<ReturnType<typeof create_test_database>>) {
  await db.insert(connections).values({
    connection_id: 'conn_slack',
    workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Slack',
    connection_status: 'active',
    connection_key: 'native:slack:summary-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: ['chat:write'],
    health_status: 'healthy',
    credentials: { bot_token: 'slack-summary-test-token' },
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  });
}

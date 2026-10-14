import { type Database, event_jobs as event_jobs_table, type events } from '@coworker/core';
import { list_connected_app_names } from '@coworker/core/db/queries/catalog';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import {
  type ChannelSweepJob,
  channel_digest_lines,
  list_channel_sweep_jobs,
} from '@runtime-platform/discovery/channel_sweep_results';
import {
  render_discovery_offers_message,
  render_nothing_found_message,
} from '@runtime-platform/discovery/discovery_offer_message';
import {
  make_workflow_proposal_writer,
  type WorkflowProposal,
} from '@runtime-platform/discovery/workflow_proposals';
import {
  first_contact_discovery_run_key,
  type SlackWorkflowProposalEventBody,
} from '@runtime-platform/events/slack_discovery_event_payload';
import {
  post_slack_message,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';
import { and, eq } from 'drizzle-orm';

const log = create_logger('slack_workflow_proposal');

type EventRecord = Pick<typeof events.$inferSelect, 'event_body'>;
type EventJob = typeof event_jobs_table.$inferSelect;

type WorkflowProposalJobInput = {
  db: Database;
  workspace_id: string;
  queue_key: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  heartbeat: () => Promise<void>;
};

export async function run_slack_workflow_proposal_job(
  input: WorkflowProposalJobInput,
): Promise<EventJobHandlerResult> {
  const { db, workspace_id } = input;
  const config = read_proposal_config(input.events);
  if (!config?.notification_channel_id) {
    return { job_status: 'failed', error_data: { code: 'workflow_proposal_unconfigured' } };
  }

  const connection = await find_active_slack_connection_for_workspace(db, workspace_id);
  const token = read_slack_bot_token(connection);
  if (!connection || !token) {
    return { job_status: 'failed', error_data: { code: 'no_active_slack_connection' } };
  }

  const sources = await read_proposal_sources(db, workspace_id, config.channel_subject_keys);
  const proposals =
    sources.source_lines.length === 0
      ? []
      : await write_proposals(workspace_id, {
          workspace_name: connection.external_account_name ?? 'this workspace',
          source_lines: sources.source_lines,
          already_proposed_titles: sources.already_proposed_titles,
          connected_tool_names: sources.connected_app_names,
        });
  if (!proposals) {
    return { job_status: 'failed', error_data: { code: 'workflow_proposal_model_failed' } };
  }

  return post_what_the_look_found({ token, workspace_id, config, sources, proposals });
}

async function post_what_the_look_found(input: {
  token: string;
  workspace_id: string;
  config: ProposalConfig;
  sources: Awaited<ReturnType<typeof read_proposal_sources>>;
  proposals: WorkflowProposal[];
}): Promise<EventJobHandlerResult> {
  const { config, sources, proposals } = input;
  const post = (text: string) =>
    post_slack_message(input.token, config.notification_channel_id, text, {
      idempotency_key: `slack_workflow_proposals:${input.workspace_id}:${config.discovery_run_key}`,
      reconcile_before_post: true,
    });

  if (proposals.length === 0) {
    const is_first_look = config.discovery_run_key === first_contact_discovery_run_key;
    if (is_first_look) await post(render_nothing_found_message());
    return {
      job_status: 'done',
      result_data: {
        proposals_created: 0,
        ...(sources.source_lines.length === 0 ? { reason: 'no_channel_digests' } : {}),
        posted_to_slack: is_first_look,
      },
    };
  }

  await post(
    render_discovery_offers_message({
      proposals,
      connected_tool_names: sources.connected_app_names,
    }),
  );
  return {
    job_status: 'done',
    result_data: {
      proposals_created: proposals.length,
      proposal_titles: proposals.map((proposal) => proposal.title),
      posted_to_slack: true,
      notification_channel_id: config.notification_channel_id,
    },
  };
}

async function read_proposal_sources(
  db: Database,
  workspace_id: string,
  channel_subject_keys: string[],
) {
  const [sweep_jobs, already_proposed_titles, connected_app_names] = await Promise.all([
    list_channel_sweep_jobs(db, { workspace_id, channel_subject_keys }),
    list_already_proposed_titles(db, workspace_id),
    list_connected_app_names(db, workspace_id),
  ]);
  return {
    source_lines: channel_digest_lines(sweep_jobs as ChannelSweepJob[]),
    already_proposed_titles,
    connected_app_names,
  };
}

async function write_proposals(
  workspace_id: string,
  input: {
    workspace_name: string;
    source_lines: string[];
    already_proposed_titles: string[];
    connected_tool_names: string[];
  },
): Promise<WorkflowProposal[] | null> {
  try {
    return await make_workflow_proposal_writer().write({ workspace_id, ...input });
  } catch (error) {
    log.error('workflow proposal model call failed', {
      workspace_id,
      error: format_error_message(error),
    });
    return null;
  }
}

async function list_already_proposed_titles(db: Database, workspace_id: string) {
  const rows = await db
    .select({ result_data: event_jobs_table.result_data })
    .from(event_jobs_table)
    .where(
      and(
        eq(event_jobs_table.workspace_id, workspace_id),
        eq(event_jobs_table.job_handler, 'slack_workflow_proposal'),
        eq(event_jobs_table.job_status, 'done'),
      ),
    );
  return rows.flatMap((row) => {
    const titles = (row.result_data as { proposal_titles?: unknown } | null)?.proposal_titles;
    return Array.isArray(titles)
      ? titles.filter((title): title is string => typeof title === 'string')
      : [];
  });
}

type ProposalConfig = NonNullable<ReturnType<typeof read_proposal_config>>;

function read_proposal_config(event_records: EventRecord[]) {
  for (const record of event_records) {
    const body = record.event_body as SlackWorkflowProposalEventBody | null;
    if (body?.notification_channel_id) {
      return {
        notification_channel_id: body.notification_channel_id,
        channel_subject_keys: body.channel_subject_keys ?? [],
        discovery_run_key: body.discovery_run_key ?? 'default',
      };
    }
  }
  return null;
}

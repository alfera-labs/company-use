import { env } from '@coworker/config';
import { out_of_credit_sentence } from '@coworker/config/billing_words';
import { connections, type Database, sessions } from '@coworker/core';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import { find_channel_for_agent_event } from '@coworker/core/db/queries/channels';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import {
  find_or_create_session_for_external_thread,
  list_session_messages,
  upsert_session_source_actor,
} from '@coworker/core/db/queries/sessions';
import { AppError, create_logger, format_error_message, type SourceActor } from '@coworker/shared';
import {
  clear_slack_assistant_status,
  type SlackAssistantStatusTarget,
  set_slack_assistant_status,
} from '@runtime-platform/channels/slack/assistant_status';
import { add_slack_processing_reaction_with_client } from '@runtime-platform/channels/slack/channel_reactions';
import {
  authorize_slack_channel_message,
  is_slack_thread_reply,
  resolve_slack_channel_conversation,
  type SlackChannelMessage,
  type SlackChannelPolicy,
} from '@runtime-platform/channels/slack/channel_routing';
import {
  collect_slack_thread_backfill_messages,
  has_slack_bot_participated_in_thread,
  type SlackThreadBackfillPolicy,
} from '@runtime-platform/channels/slack/channel_thread_history';
import { resolve_slack_conversation_label } from '@runtime-platform/channels/slack/conversation_label';
import { read_slack_speaker } from '@runtime-platform/channels/slack/slack_speaker';
import { classify_slack_thread_audience } from '@runtime-platform/channels/slack/thread_audience';
import { slack_run_failure_text } from '@runtime-platform/channels/slack/turn_failure';
import {
  finalize_slack_channel_turn,
  type SlackTurnFinalizeResult,
} from '@runtime-platform/channels/slack/turn_finalize';
import { create_slack_live_status } from '@runtime-platform/channels/slack/turn_live_status';
import { build_slack_turn_queue_key } from '@runtime-platform/channels/slack/turn_subject';
import { create_slack_web_api } from '@runtime-platform/channels/slack/web_api';
import {
  type AgentRunJob,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { is_agent_run_stopped } from '@runtime-platform/orchestrator/agent_run_stopped';
import type {
  StartAgentRunInput,
  StartAgentRunPriorMessage,
} from '@runtime-platform/orchestrator/runtime_orchestrator';
import { post_slack_message_with_client } from '@runtime-platform/tools/slack/channels_api';
import type { WebClient } from '@slack/web-api';
import { and, eq, ne } from 'drizzle-orm';

export type StartSlackChannelTurnInput = {
  workspace_id: string;
  agent_id: string;
  actor_id: string;
  connection_id: string;
  message: SlackChannelMessage;
  // The project the channel route works in: a new chat in the channel starts there, with its
  // instructions and its tools. A DM ignores it and starts in the sender's own room.
  channel_project_id?: string | null;
  prior_messages?: StartAgentRunPriorMessage[];
  known_thread_reply?: boolean;
  channel_policy_override?: SlackChannelPolicy;
  run_options?: Pick<
    StartAgentRunInput,
    | 'reasoning_level'
    | 'temperature'
    | 'max_output_tokens'
    | 'workspace_runtime_provider'
    | 'workspace_base_path'
    | 'resumed_from_job_id'
  >;
  user_message_source_metadata_patch?: Record<string, unknown>;
  attachment_sources?: StartAgentRunInput['attachment_sources'];
  job?: AgentRunJob;
  starting_message?: { text: string; idempotency_key: string };
};

export type StartSlackChannelTurnResult =
  | {
      accepted: true;
      configured_channel_id: string | null;
      session_id: string;
      run_id: string;
      external_thread_key: string;
      turn_finalize: SlackTurnFinalizeResult;
    }
  | {
      accepted: false;
      code: string;
      message: string;
    };

const log = create_logger('slack_channel_turn');
const slack_agent_run_reasoning_level = 'medium';
const out_of_credits_slack_text = out_of_credit_sentence(env.APP_UPGRADE_URL);

export async function start_slack_channel_turn(
  db: Database,
  input: StartSlackChannelTurnInput,
): Promise<StartSlackChannelTurnResult> {
  const slack_conversation = resolve_slack_channel_conversation(input.message);
  const slack_api = await create_slack_web_api(db, input.workspace_id, input.connection_id);
  const status_target: SlackAssistantStatusTarget = {
    channel_id: input.message.channel_id,
    thread_ts: resolve_slack_delivery_thread_ts(input.message, slack_conversation),
  };
  if (input.starting_message) {
    await post_slack_turn_starting_message(slack_api, status_target, input.starting_message);
  }
  const pending_turn_status = set_slack_turn_status(slack_api, status_target);
  const classify_audience = should_classify_slack_thread_audience(input);
  const channel_config = await resolve_slack_channel_config(db, input, slack_conversation);
  const existing_thread_session = await find_existing_slack_thread_session(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    external_thread_key: slack_conversation.external_thread_key,
    message: input.message,
  });
  const slack_history_thread_participation =
    existing_thread_session || input.message.mentioned_bot_user_id || input.known_thread_reply
      ? false
      : await can_continue_slack_thread_from_history(db, input, slack_conversation, channel_config);
  const known_thread_reply =
    Boolean(existing_thread_session) ||
    slack_history_thread_participation ||
    input.known_thread_reply === true;
  const authorization = authorize_slack_channel_message(
    input.message,
    channel_config.channel_policy,
    { known_thread_reply },
  );
  const turn_ui = { slack_api, status_target, pending_turn_status };
  if (!authorization.authorized) return refuse_slack_turn(turn_ui, authorization);

  if (slack_user_content(input.message).length === 0) {
    return refuse_slack_turn(turn_ui, {
      code: 'empty_message',
      message: 'Nothing after the mention.',
      text: "I'm here — what do you need?",
    });
  }

  const speaker = await read_slack_speaker(db, input, { spoke_to_the_agent: !classify_audience });
  if ('refusal' in speaker) return refuse_slack_turn(turn_ui, speaker.refusal);
  const source_actor = speaker.source_actor;
  const room_id =
    existing_thread_session || input.message.channel_type !== 'im'
      ? (input.channel_project_id ?? undefined)
      : (
          await open_personal_project(db, {
            workspace_id: input.workspace_id,
            user_id: speaker.member_user_id,
          })
        ).project_id;
  const session =
    existing_thread_session ??
    (await find_or_create_session_for_external_thread(db, {
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      session_source: 'slack',
      external_thread_key: slack_conversation.external_thread_key,
      ...(room_id === undefined ? {} : { project_id: room_id }),
      session_title: () => build_slack_session_title(slack_api, input.message),
      session_metadata: { title_generation: { source: 'placeholder' } },
      source_metadata: build_slack_session_source_metadata(
        input.message,
        slack_conversation,
        channel_config.configured_channel_id,
      ),
      actor_id: input.actor_id,
    }));
  const [, existing_messages] = await Promise.all([
    upsert_session_source_actor(db, {
      workspace_id: input.workspace_id,
      session_id: session.session_id,
      source_actor,
      observed_time: read_slack_event_time(input.message.event_ts),
      actor_id: input.actor_id,
    }),
    list_session_messages(db, input.workspace_id, session.session_id),
  ]);
  const slack_history_messages =
    input.prior_messages?.length || slack_conversation.thread_ts === undefined
      ? []
      : await collect_slack_thread_backfill_messages(db, {
          workspace_id: input.workspace_id,
          connection_id: input.connection_id,
          message: input.message,
          thread_ts: slack_conversation.thread_ts as string,
          policy: channel_config.context_backfill,
          existing_messages,
        });
  const prior_messages = [...slack_history_messages, ...(input.prior_messages ?? [])];
  if (classify_audience) {
    const audience = classify_slack_thread_audience({
      message: input.message,
      stored_messages: existing_messages,
      prior_messages,
    });
    if (audience === 'other') {
      return refuse_slack_turn(turn_ui, {
        code: 'message_not_for_agent',
        message: 'Slack thread message is addressed to another participant.',
      });
    }
    await add_slack_processing_reaction_with_client(slack_api, {
      channel_id: input.message.channel_id,
      event_ts: input.message.event_ts,
    });
  }
  const user_message_source_metadata = {
    ...build_slack_message_source_metadata(
      input.message,
      source_actor,
      channel_config.configured_channel_id,
      input.connection_id,
    ),
    ...input.user_message_source_metadata_patch,
  };
  let run_error: unknown;
  let billing_refusal: string | null = null;
  const live_status = create_slack_live_status({
    set_status: (status) =>
      set_slack_assistant_status(slack_api, status_target, status, { rotate: false }),
    app_name_for: catalog_app_name_lookup(db, input.workspace_id),
  });

  const run = await start_agent_run_for_job(
    db,
    {
      workspace_id: input.workspace_id,
      session_id: session.session_id,
      user_content: slack_user_content(input.message),
      attachment_sources: input.attachment_sources ?? [],
      prior_messages,
      source_type: 'slack',
      user_message_source_metadata,
      actor_id: input.actor_id,
      ...input.run_options,
      reasoning_level: input.run_options?.reasoning_level ?? slack_agent_run_reasoning_level,
    },
    input.job,
    {
      on_stream_event: async (event) => {
        if (event.type === 'chat_event') void live_status.on_event(event.event);
      },
    },
  )
    .catch(async (error: unknown) => {
      if (is_agent_run_stopped(error)) throw error;
      const refusal_text = billing_refusal_slack_text(error);
      if (!refusal_text) {
        run_error = error;
        return null;
      }

      billing_refusal = refusal_text;
      await post_slack_system_message(
        slack_api,
        status_target,
        billing_refusal_slack_message(refusal_text),
      );
      return null;
    })
    .finally(async () => {
      live_status.stop();
      await pending_turn_status;
      await clear_slack_turn_status(slack_api, status_target);
    });
  if (!run) {
    if (run_error) {
      await post_slack_system_message(slack_api, status_target, {
        text: slack_run_failure_text,
      });
      throw run_error;
    }
    return {
      accepted: false,
      code: billing_refusal ? 'out_of_credits' : 'slack_run_failed',
      message: billing_refusal ? 'Billing refused this turn.' : 'Slack run failed.',
    };
  }
  const turn_finalize: SlackTurnFinalizeResult = await finalize_slack_channel_turn(db, {
    slack_api,
    workspace_id: input.workspace_id,
    run_id: run.run_id,
    run_status: run.run_status,
    run_error_message: run.error_message,
    channel_id: status_target.channel_id,
    thread_ts: status_target.thread_ts ?? input.message.event_ts,
    actor_id: input.actor_id,
    finalized_by: 'slack_channel_turn',
  });

  return {
    accepted: true,
    configured_channel_id: channel_config.configured_channel_id,
    session_id: session.session_id,
    run_id: run.run_id,
    external_thread_key: slack_conversation.external_thread_key,
    turn_finalize,
  };
}

async function refuse_slack_turn(
  turn_ui: {
    slack_api: WebClient;
    status_target: SlackAssistantStatusTarget;
    pending_turn_status: Promise<unknown>;
  },
  refusal: { code: string; message: string; text?: string },
): Promise<StartSlackChannelTurnResult> {
  await turn_ui.pending_turn_status;
  if (refusal.text) {
    await post_slack_system_message(turn_ui.slack_api, turn_ui.status_target, {
      text: refusal.text,
    });
  }
  await clear_slack_turn_status(turn_ui.slack_api, turn_ui.status_target);
  return { accepted: false, code: refusal.code, message: refusal.message };
}

function should_classify_slack_thread_audience(input: StartSlackChannelTurnInput) {
  return (
    is_slack_thread_reply(input.message) &&
    !input.message.mentioned_bot_user_id &&
    !input.starting_message
  );
}

async function set_slack_turn_status(slack_api: WebClient, target: SlackAssistantStatusTarget) {
  try {
    await set_slack_assistant_status(slack_api, target);
  } catch (error) {
    log_slack_turn_ui_error('set_status', target, error);
  }
}

async function clear_slack_turn_status(slack_api: WebClient, target: SlackAssistantStatusTarget) {
  try {
    await clear_slack_assistant_status(slack_api, target);
  } catch (error) {
    log_slack_turn_ui_error('clear_status', target, error);
  }
}

async function post_slack_turn_starting_message(
  slack_api: WebClient,
  target: SlackAssistantStatusTarget,
  message: NonNullable<StartSlackChannelTurnInput['starting_message']>,
) {
  try {
    await post_slack_message_with_client(slack_api, target.channel_id, message.text, {
      thread_ts: target.thread_ts,
      idempotency_key: message.idempotency_key,
      reconcile_before_post: true,
    });
  } catch (error) {
    log_slack_turn_ui_error('post_starting_message', target, error);
  }
}

async function post_slack_system_message(
  slack_api: WebClient,
  target: SlackAssistantStatusTarget,
  input: { text: string; blocks?: unknown[] },
) {
  return slack_api.apiCall('chat.postMessage', {
    channel: target.channel_id,
    thread_ts: target.thread_ts,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
    unfurl_links: false,
    unfurl_media: false,
  });
}

function log_slack_turn_ui_error(
  operation: 'set_status' | 'clear_status' | 'post_starting_message',
  target: SlackAssistantStatusTarget,
  error: unknown,
) {
  log.error('Slack UI update failed', {
    operation,
    channel_id: target.channel_id,
    thread_ts: target.thread_ts,
    error: format_error_message(error),
  });
}

function slack_user_content(message: SlackChannelMessage) {
  return [
    ...(message.text?.trim() ? [{ type: 'text' as const, text: message.text }] : []),
    ...(message.files ?? []).map((file) => ({
      type: 'file' as const,
      file_id: `slack:${message.team_id}:${file.external_file_id}`,
      ...(file.file_name ? { name: file.file_name } : {}),
      ...(file.mime_type ? { mime_type: file.mime_type } : {}),
    })),
  ];
}

function billing_refusal_slack_text(error: unknown) {
  if (!(error instanceof AppError)) return null;
  if (error.code === 'out_of_credits') return out_of_credits_slack_text;
  return null;
}

function billing_refusal_slack_message(text: string) {
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Go to Alfera',
            },
            url: env.APP_UPGRADE_URL,
          },
        ],
      },
    ],
  };
}

async function can_continue_slack_thread_from_history(
  db: Database,
  input: StartSlackChannelTurnInput,
  conversation: ReturnType<typeof resolve_slack_channel_conversation>,
  channel_config: { context_backfill: SlackThreadBackfillPolicy },
) {
  if (!conversation.thread_ts || !is_slack_thread_reply(input.message)) return false;

  return has_slack_bot_participated_in_thread(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    message: input.message,
    thread_ts: conversation.thread_ts,
    policy: channel_config.context_backfill,
  });
}

function resolve_slack_delivery_thread_ts(
  target: SlackChannelMessage,
  conversation: ReturnType<typeof resolve_slack_channel_conversation>,
) {
  return conversation.thread_ts ?? target.event_ts;
}

async function resolve_slack_channel_config(
  db: Database,
  input: StartSlackChannelTurnInput,
  conversation: ReturnType<typeof resolve_slack_channel_conversation>,
): Promise<{
  configured_channel_id: string | null;
  channel_policy: SlackChannelPolicy;
  context_backfill: SlackThreadBackfillPolicy;
}> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.connection_id, input.connection_id),
    ),
  });
  const channel = await find_channel_for_agent_event(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    connection_id: input.connection_id,
    channel_provider_key: 'slack',
    external_account_id: input.message.team_id,
    external_conversation_id: input.message.channel_id,
    ...(conversation.thread_ts ? { external_thread_id: conversation.thread_ts } : {}),
    conversation_scope: conversation.scope,
  });

  const channel_policy = {
    ...(connection?.connection_config.slack?.channel_policy ?? {}),
    ...(channel?.channel_config.channel_policy ?? {}),
    ...input.channel_policy_override,
  };
  const context_backfill = {
    ...(connection?.connection_config.slack?.context_backfill ?? {}),
    ...(channel?.channel_config.context_backfill ?? {}),
  };

  return {
    configured_channel_id: channel?.channel_id ?? null,
    channel_policy,
    context_backfill,
  };
}

async function find_existing_slack_thread_session(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    external_thread_key: string;
    message: SlackChannelMessage;
  },
) {
  if (!is_slack_thread_reply(input.message)) return null;
  return (
    (await db.query.sessions.findFirst({
      where: and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.agent_id, input.agent_id),
        eq(sessions.session_source, 'slack'),
        eq(sessions.external_thread_key, input.external_thread_key),
        ne(sessions.session_status, 'deleted'),
      ),
    })) ?? null
  );
}

async function build_slack_session_title(slack_api: WebClient, target: SlackChannelMessage) {
  const slack_conversation = resolve_slack_channel_conversation(target);
  const label = await resolve_slack_conversation_label(slack_api, target);
  const is_channel_thread = slack_conversation.scope === 'thread' && label.startsWith('#');
  return is_channel_thread ? `${label} thread` : label;
}

function build_slack_session_source_metadata(
  target: SlackChannelMessage,
  slack_conversation = resolve_slack_channel_conversation(target),
  configured_channel_id?: string | null,
) {
  return {
    slack: {
      ...(configured_channel_id ? { configured_channel_id } : {}),
      team_id: target.team_id,
      channel_id: target.channel_id,
      channel_type: target.channel_type,
      conversation_scope: slack_conversation.scope,
      ...(slack_conversation.thread_ts ? { thread_ts: slack_conversation.thread_ts } : {}),
    },
  };
}

function build_slack_message_source_metadata(
  target: SlackChannelMessage,
  source_actor: SourceActor,
  configured_channel_id?: string | null,
  connection_id?: string,
) {
  const slack_conversation = resolve_slack_channel_conversation(target);
  return {
    source_actor,
    slack: {
      ...(connection_id ? { connection_id } : {}),
      ...(configured_channel_id ? { configured_channel_id } : {}),
      team_id: target.team_id,
      channel_id: target.channel_id,
      channel_type: target.channel_type,
      event_ts: target.event_ts,
      ...(slack_conversation.thread_ts ? { thread_ts: slack_conversation.thread_ts } : {}),
      ...(target.thread_ts ? { raw_thread_ts: target.thread_ts } : {}),
      ...(target.raw_text ? { raw_text: target.raw_text } : {}),
      conversation_scope: slack_conversation.scope,
      addressing_mode: slack_addressing_mode(target),
      user_id: target.user_id,
      turn_subject_key: build_slack_turn_queue_key(target),
    },
  };
}

function slack_addressing_mode(
  target: SlackChannelMessage,
): 'direct_message' | 'explicit_mention' | 'thread_continuation' | 'channel_message' {
  if (target.channel_type === 'im') return 'direct_message';
  if (target.mentioned_bot_user_id) return 'explicit_mention';
  if (is_slack_thread_reply(target)) return 'thread_continuation';
  return 'channel_message';
}

function read_slack_event_time(event_ts: string) {
  const milliseconds = Number.parseFloat(event_ts) * 1000;
  if (!Number.isFinite(milliseconds)) return new Date();
  return new Date(milliseconds);
}
function catalog_app_name_lookup(db: Database, workspace_id: string) {
  const known = new Map<string, Promise<string | null>>();
  return (node_key: string) => {
    const cached = known.get(node_key);
    if (cached) return cached;
    const found = get_tool_catalog_entry(db, { node_key, workspace_id }).then((entry) =>
      entry?.connection_profile_key ? entry.app_display_name : null,
    );
    known.set(node_key, found);
    return found;
  };
}

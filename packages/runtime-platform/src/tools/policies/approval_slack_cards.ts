import type { Database } from '@coworker/core';
import { get_session } from '@coworker/core/db/queries/sessions';
import { get_user } from '@coworker/core/db/queries/users';
import type { event_jobs } from '@coworker/core/db/schema';
import {
  AppError,
  create_logger,
  describe_approval_call,
  read_tool_input_fields,
} from '@coworker/shared';
import { escape_slack_entities } from '@runtime-platform/channels/slack/message_format';
import { read_slack_resume_target } from '@runtime-platform/channels/slack/slack_session_target';
import {
  find_active_slack_connection_for_workspace,
  find_active_slack_connection_for_workspace_team,
} from '@runtime-platform/channels/slack/workspace_connection';
import { build_batch_approval_card } from '@runtime-platform/tools/policies/approval_batch_card';
import { read_approval_batch } from '@runtime-platform/tools/policies/approval_batch_grant';
import {
  allow_days,
  approval_allow_30_days_action_id,
  approval_allow_automation_action_id,
  approval_allow_chat_action_id,
  approval_always_action_id,
  approval_approve_action_id,
  approval_refuse_action_id,
  clip,
  decision_button,
  inbox_url,
  open_in_alfera_button,
  settings_footer,
} from '@runtime-platform/tools/policies/approval_card_parts';
import {
  read_tool_approval_view,
  type ToolApprovalView,
} from '@runtime-platform/tools/policies/approval_reader_service';
import {
  lookup_slack_user_id_by_email,
  open_slack_dm_channel,
  post_slack_message,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';

const log = create_logger('approval_slack_cards');

const max_card_fields = 6;

export * from '@runtime-platform/tools/policies/approval_card_parts';

type EventJob = typeof event_jobs.$inferSelect;

export type ApprovalCard = { text: string; blocks: unknown[] };

export async function send_slack_approval_cards(
  db: Database,
  input: { workspace_id: string; wait: EventJob },
) {
  const view = await read_tool_approval_view(db, input.workspace_id, input.wait);
  if (!view) return 0;

  const card = build_approval_card(view);
  const in_the_thread = await post_card_in_the_thread(db, input.workspace_id, view, card);
  if (in_the_thread) return 1;

  const delivered = await send_cards_to_deciders(db, input.workspace_id, view, card);
  if (delivered === 0) {
    log.info('no approval card was delivered for a held step', {
      workspace_id: input.workspace_id,
      job_id: input.wait.job_id,
      decider_count: view.eligible_user_ids.length,
    });
  }
  return delivered;
}

async function post_card_in_the_thread(
  db: Database,
  workspace_id: string,
  view: ToolApprovalView,
  card: ApprovalCard,
) {
  const session = await get_session(db, workspace_id, view.session_id);
  const target = session ? read_slack_resume_target(session) : null;
  if (!target) return false;

  const connection = await find_active_slack_connection_for_workspace_team(db, {
    workspace_id,
    team_id: target.team_id,
  });
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!token) return false;

  await post_card(token, target.channel_id, card, target.thread_ts);
  return true;
}

async function send_cards_to_deciders(
  db: Database,
  workspace_id: string,
  view: ToolApprovalView,
  card: ApprovalCard,
) {
  const connection = await find_active_slack_connection_for_workspace(db, workspace_id);
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!token) return 0;

  let delivered = 0;
  for (const user_id of view.eligible_user_ids) {
    if (await send_card_to_decider(db, token, user_id, card)) delivered += 1;
  }
  return delivered;
}

async function send_card_to_decider(
  db: Database,
  token: string,
  user_id: string,
  card: ApprovalCard,
) {
  const user = await get_user(db, user_id);
  if (!user?.email) return false;

  const slack_user_id = await lookup_slack_user_id_by_email(token, user.email);
  if (!slack_user_id) return false;

  const dm_channel = await open_slack_dm_channel(token, slack_user_id);
  if (!dm_channel) return false;

  await post_card(token, dm_channel, card);
  return true;
}

// A whole message is rejected when one block is malformed, and the step is already held. A refused
// card is sent again as plain text with the link, so the worst case is an uglier message rather
// than a person who was never told.
async function post_card(
  token: string,
  channel: string,
  card: ApprovalCard,
  thread_ts?: string | null,
) {
  const options = thread_ts ? { thread_ts } : {};
  try {
    await post_slack_message(token, channel, card.text, { ...options, blocks: card.blocks });
  } catch (error) {
    if (!is_invalid_blocks_error(error)) throw error;
    log.warn('the approval card blocks were refused; sending it as text', { channel });
    await post_slack_message(token, channel, `${card.text}\n${inbox_url()}`, options);
  }
}

function is_invalid_blocks_error(error: unknown) {
  return (
    error instanceof AppError &&
    (error.details as { slack_error?: string } | undefined)?.slack_error === 'invalid_blocks'
  );
}

export function build_approval_card(view: ToolApprovalView): ApprovalCard {
  const batch = read_approval_batch(view);
  if (batch) return build_batch_approval_card(view, batch);

  const text = card_sentence(view);
  const fields = card_field_lines(view);
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: mrkdwn_sentence(view) } },
      ...(fields ? [{ type: 'section', text: { type: 'mrkdwn', text: fields } }] : []),
      { type: 'actions', elements: decision_buttons(view) },
      { type: 'context', elements: [{ type: 'mrkdwn', text: settings_footer }] },
    ],
  };
}

function decision_buttons(view: ToolApprovalView) {
  return [
    decision_button('Approve', 'primary', approval_approve_action_id, view.job_id),
    decision_button('Refuse', 'danger', approval_refuse_action_id, view.job_id),
    view.automation_id
      ? decision_button(
          'Allow for this automation',
          null,
          approval_allow_automation_action_id,
          view.job_id,
        )
      : decision_button('Allow for this chat', null, approval_allow_chat_action_id, view.job_id),
    decision_button(
      `Allow for ${allow_days} days`,
      null,
      approval_allow_30_days_action_id,
      view.job_id,
    ),
    decision_button('Always allow', null, approval_always_action_id, view.job_id),
    open_in_alfera_button(),
  ];
}

function card_sentence(view: ToolApprovalView) {
  const what = describe_the_ask(view);
  const helping = view.requested_by_name ? `, while helping ${view.requested_by_name}` : '';
  return `I need your OK to ${what}${helping}.`;
}

function mrkdwn_sentence(view: ToolApprovalView) {
  const lines = [`I need your OK to *${escape_slack_entities(describe_the_ask(view))}*`];
  if (view.requested_by_name) {
    lines.push(`_While helping ${escape_slack_entities(view.requested_by_name)}._`);
  }
  if (view.calls.length > 1) {
    lines.push(
      `_And ${view.calls.length - 1} more step${view.calls.length === 2 ? '' : 's'} — one answer covers all of them._`,
    );
  }
  return lines.join('\n');
}

export function describe_the_ask(view: ToolApprovalView) {
  const [first] = view.calls;
  return first ? describe_approval_call(first) : 'do something';
}

function card_field_lines(view: ToolApprovalView) {
  const lines = view.calls
    .flatMap((call) =>
      read_tool_input_fields(call.input, call.input_schema, call.approval_display_fields),
    )
    .slice(0, max_card_fields)
    .map(
      (field) =>
        `*${escape_slack_entities(field.label)}:* ${escape_slack_entities(clip(field.value))}`,
    );
  return lines.join('\n');
}

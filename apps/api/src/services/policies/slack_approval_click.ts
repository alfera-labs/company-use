import {
  answer_on_the_card,
  deliver_the_answer,
  read_slack_click_press,
  ephemeral_reply as reply,
  type SlackClickPress,
  type SlackClickReply,
} from '@api/services/channels/slack_click_payload';
import { answer_notification_press } from '@api/services/notifications/slack_notification_click';
import { is_policy_workspace_administrator } from '@api/services/policies/policy_authority';
import {
  type ApprovalGrantKind,
  type ApprovalRemembered,
  remember_the_approval,
} from '@api/services/policies/remember_the_approval';
import type { Database } from '@coworker/core';
import {
  read_calls_a_person_is_asked_about,
  tool_policy_approval_wait_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import { get_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import { find_user_by_email } from '@coworker/core/db/queries/users';
import { record_the_answer } from '@coworker/runtime-platform';
import { find_active_slack_connection } from '@runtime-platform/channels/slack/channel_event_dispatch';
import {
  read_tool_approval_view,
  type ToolApprovalView,
} from '@runtime-platform/tools/policies/approval_reader_service';
import {
  approval_allow_30_days_action_id,
  approval_allow_automation_action_id,
  approval_allow_chat_action_id,
  approval_always_action_id,
  approval_approve_action_id,
  approval_approve_batch_action_id,
  approval_refuse_action_id,
  describe_the_ask,
  tool_permissions_settings_path,
} from '@runtime-platform/tools/policies/approval_slack_cards';
import {
  lookup_slack_user_email,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';

const presses_by_action_id: Record<
  string,
  { decision: 'approved' | 'denied'; grant: ApprovalGrantKind }
> = {
  [approval_approve_action_id]: { decision: 'approved', grant: 'none' },
  [approval_refuse_action_id]: { decision: 'denied', grant: 'none' },
  [approval_always_action_id]: { decision: 'approved', grant: 'perpetual' },
  [approval_allow_chat_action_id]: { decision: 'approved', grant: 'chat' },
  [approval_allow_30_days_action_id]: { decision: 'approved', grant: 'time_bounded' },
  [approval_allow_automation_action_id]: { decision: 'approved', grant: 'automation' },
  [approval_approve_batch_action_id]: { decision: 'approved', grant: 'batch' },
};

export async function decide_from_slack_click(
  db: Database,
  body_text: string,
): Promise<SlackClickReply | null> {
  const press = read_slack_click_press(body_text);
  if (!press) return null;

  const notification_answer = await answer_notification_press(db, press);
  if (notification_answer) return deliver_the_answer(press, notification_answer);

  const approval = read_approval_press(press);
  if (!approval) return null;
  return deliver_the_answer(press, await answer_the_press(db, approval));
}

async function answer_the_press(
  db: Database,
  press: NonNullable<ReturnType<typeof read_approval_press>>,
): Promise<SlackClickReply | null> {
  const connection = await find_active_slack_connection(db, { team_id: press.team_id });
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!connection || !token) return reply('This Slack workspace is not connected to Alfera.');

  const wait = await get_tool_policy_wait(db, {
    workspace_id: connection.workspace_id,
    job_id: press.job_id,
  });
  if (!wait) return reply('That request is not here anymore. Open Alfera to check.');

  const approval = tool_policy_approval_wait_schema.safeParse(wait.metadata.policy_approval);
  if (!approval.success) return reply('That request cannot be read. Open Alfera to answer it.');

  const decided_by = await find_the_person_who_pressed(db, {
    workspace_id: connection.workspace_id,
    token,
    slack_user_id: press.slack_user_id,
    eligible_user_ids: approval.data.eligible_user_ids,
  });
  if (!decided_by) {
    return reply('Only somebody this was asked of can answer it — open Alfera to check.');
  }

  if (wait.job_status !== 'waiting') return reply('Somebody already answered this one.');

  const asked_about = read_calls_a_person_is_asked_about(approval.data).map(
    (call) => call.tool_call_id,
  );
  const view = await read_tool_approval_view(db, connection.workspace_id, wait);
  const wrote = await remember_the_approval(db, {
    workspace_id: connection.workspace_id,
    user_id: decided_by,
    session_id: approval.data.session_id,
    tool_call_ids: asked_about,
    kind: press.decision === 'approved' ? press.grant : 'none',
    view,
  });

  const answered = await record_the_answer(db, {
    workspace_id: connection.workspace_id,
    job_id: wait.job_id,
    queue_key: wait.awaits_queue_key ?? wait.queue_key,
    decided_by,
    decision: press.decision,
  });
  if (!answered) return reply('Somebody already answered this one.');

  return answer_on_the_card(press, outcome_line(press, wrote, view));
}

function outcome_line(
  press: { decision: 'approved' | 'denied'; slack_user_id: string },
  wrote: ApprovalRemembered,
  view: ToolApprovalView | null,
) {
  const who = `<@${press.slack_user_id}>`;
  if (press.decision === 'denied') return `✗ Refused by ${who}. The agent has been told.`;
  if (wrote.remembered_in_this_chat) {
    return wrote.remembered_in_this_chat.remembered
      ? `✓ Approved by ${who} — this chat won't be asked about it again.`
      : `✓ Approved by ${who}. That could not be saved, so it will ask again.`;
  }
  if (!wrote.remembered) return `✓ Approved by ${who} — the agent is continuing.`;
  if (!wrote.remembered.remembered) {
    return `✓ Approved by ${who}. That could not be saved, so it will ask again.`;
  }
  const what = view ? describe_the_ask(view) : 'this';
  return `✓ Approved by ${who} — not asking about ${what} again ${wrote.grant_label}. Change this anytime in ${tool_permissions_settings_path}.`;
}

async function find_the_person_who_pressed(
  db: Database,
  input: {
    workspace_id: string;
    token: string;
    slack_user_id: string;
    eligible_user_ids: readonly string[];
  },
) {
  const email = await lookup_slack_user_email(input.token, input.slack_user_id);
  if (!email) return null;

  const user = await find_user_by_email(db, email);
  if (!user) return null;
  if (input.eligible_user_ids.includes(user.user_id)) return user.user_id;

  const is_administrator = await is_policy_workspace_administrator(db, {
    workspace_id: input.workspace_id,
    user_id: user.user_id,
  });
  return is_administrator ? user.user_id : null;
}

function read_approval_press(press: SlackClickPress) {
  const meaning = presses_by_action_id[press.action_id];
  if (!meaning) return null;
  return {
    ...press,
    job_id: press.value,
    decision: meaning.decision,
    grant: meaning.grant,
  };
}

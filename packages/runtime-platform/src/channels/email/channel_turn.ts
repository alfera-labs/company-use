import type { Database } from '@coworker/core';
import { upsert_session_source_actor } from '@coworker/core/db/queries/sessions';
import { list_members_to_match_by_email } from '@coworker/core/db/queries/team_match_emails';
import { find_team_room_of_maker } from '@coworker/core/db/queries/team_room_of_maker';
import { find_workspace_main_agent } from '@coworker/core/db/queries/workspace_agents';
import { create_logger } from '@coworker/shared';
import { answer_approval_from_email } from '@runtime-platform/channels/email/approval_reply';
import {
  email_actor_id,
  type OpenedEmailTurn,
  run_the_email_turn,
} from '@runtime-platform/channels/email/channel_turn_run';
import { build_inbound_email_address } from '@runtime-platform/channels/email/inbound_address';
import { fire_inbound_email_ears } from '@runtime-platform/channels/email/inbound_email_ears';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { sender_is_trusted_member } from '@runtime-platform/channels/email/sender_authentication';
import { find_or_create_email_thread_session } from '@runtime-platform/channels/email/thread_sessions';
import type { EmailTurnFinalizeResult } from '@runtime-platform/channels/email/turn_finalize';
import {
  build_email_source_actor,
  build_email_turn_metadata,
} from '@runtime-platform/channels/email/turn_metadata';
import type { AgentRunJob } from '@runtime-platform/orchestrator/agent_run_job';

const log = create_logger('email_channel_turn');

export type StartEmailChannelTurnInput = {
  workspace_id: string;
  workspace_username: string;
  message: InboundEmailMessage;
  job?: AgentRunJob;
};

export type StartEmailChannelTurnResult =
  | {
      accepted: true;
      session_id: string;
      run_id: string;
      turn_finalize: EmailTurnFinalizeResult;
    }
  | {
      accepted: false;
      code: 'agent_missing' | 'out_of_credits' | 'card_required' | 'approval_answered';
      message: string;
    };

export async function start_email_channel_turn(
  db: Database,
  input: StartEmailChannelTurnInput,
): Promise<StartEmailChannelTurnResult> {
  const agent = await find_workspace_main_agent(db, input.workspace_id);
  if (!agent) {
    return {
      accepted: false,
      code: 'agent_missing',
      message: `Workspace ${input.workspace_id} has no active main agent.`,
    };
  }

  const sender = read_sender_trust(
    input,
    await list_members_to_match_by_email(db, input.workspace_id),
  );
  const opened = await open_the_thread_session(db, input, { agent_id: agent.agent_id, sender });

  const answered = sender.member_user_id
    ? await answer_approval_from_email(db, {
        workspace_id: input.workspace_id,
        session_id: opened.thread.session_id,
        message: input.message,
        decided_by: sender.member_user_id,
      })
    : null;
  if (answered) {
    return {
      accepted: false,
      code: 'approval_answered',
      message: `${answered.decision} approval ${answered.job_id}`,
    };
  }

  const result = await run_the_email_turn(db, input, opened);
  if (result.accepted) {
    await fire_inbound_email_ears(db, {
      workspace_id: input.workspace_id,
      message: input.message,
    });
  }
  return result;
}

type EmailSenderTrust = {
  member_emails: string[];
  is_workspace_member: boolean;
  member_user_id?: string;
};

function read_sender_trust(
  input: StartEmailChannelTurnInput,
  members: Awaited<ReturnType<typeof list_members_to_match_by_email>>,
): EmailSenderTrust {
  const member_emails = members.map((member) => member.email.toLowerCase());
  const claims_member_address = member_emails.includes(input.message.from_email);
  const is_workspace_member = sender_is_trusted_member(input.message, member_emails);
  if (claims_member_address && !is_workspace_member) {
    log.warn(
      'email claims a member address but failed sender authentication; treating as a stranger',
      {
        workspace_id: input.workspace_id,
        from_email: input.message.from_email,
        dmarc: input.message.sender_authentication.dmarc,
        spf: input.message.sender_authentication.spf,
        dkim: input.message.sender_authentication.dkim,
      },
    );
  }
  const member = is_workspace_member
    ? members.find((row) => row.email.toLowerCase() === input.message.from_email)
    : null;
  return {
    member_emails,
    is_workspace_member,
    ...(member ? { member_user_id: member.user_id } : {}),
  };
}

async function open_the_thread_session(
  db: Database,
  input: StartEmailChannelTurnInput,
  context: { agent_id: string; sender: EmailSenderTrust },
): Promise<OpenedEmailTurn> {
  const workspace_address = build_inbound_email_address(input.workspace_username);
  const thread = await find_or_create_email_thread_session(db, {
    workspace_id: input.workspace_id,
    default_agent_id: context.agent_id,
    workspace_address,
    message: input.message,
    member_emails: context.sender.member_emails,
    actor_id: email_actor_id,
    ...(await find_team_room_of_maker(db, {
      workspace_id: input.workspace_id,
      maker_id: context.sender.member_user_id ?? email_actor_id,
    })),
  });
  const source_actor = build_email_source_actor(input.message);
  await upsert_session_source_actor(db, {
    workspace_id: input.workspace_id,
    session_id: thread.session_id,
    source_actor,
    observed_time: new Date(),
    actor_id: email_actor_id,
  });
  return {
    thread,
    source_actor,
    turn: {
      ...build_email_turn_metadata({ workspace_address, message: input.message, thread }),
      sender_is_workspace_member: context.sender.is_workspace_member,
    },
  };
}

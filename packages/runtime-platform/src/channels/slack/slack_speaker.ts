import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core';
import { find_active_workspace_member_by_email } from '@coworker/core/db/queries/workspace_member_by_email';
import {
  create_external_source_actor,
  type SourceActor,
  type SourceActorProfile,
} from '@coworker/shared';
import type { SlackChannelMessage } from '@runtime-platform/channels/slack/channel_routing';

export type SlackSpeaker = {
  source_actor: SourceActor;
  member_user_id: string;
};

export type SlackSpeakerRefusal = { code: string; message: string; text?: string };

const speaker_is_not_a_member = {
  code: 'slack_speaker_is_not_a_member',
  message: 'A Slack message needs a speaker who is a member of the workspace.',
  text: "I only work with members of this Alfera workspace, and I couldn't find an Alfera account for your Slack email. Ask an admin to invite you with that email, then message me again.",
};

const how_a_team_member_is_known =
  'I only work with members of this Alfera workspace, and no member has your Slack email. If you are a member, open Settings, then Profile, in the Alfera dashboard and enter the email you use in Slack. Then message me again.';

const speaker_is_unknown = {
  code: 'slack_speaker_is_unknown',
  message: 'Slack gave no email for the speaker of this message.',
  text: "I couldn't check your Alfera account just now. Send that again in a moment.",
};

/**
 * Alfera answers members of the workspace only. A run reads the workspace's memory, chats, files
 * and connections, so a Slack guest or a person with no Alfera account gets a refusal, in a DM
 * and in a channel alike. A thread reply that may be meant for another person is refused in
 * silence, so a channel is not filled with refusals nobody asked for.
 */
export async function read_slack_speaker(
  db: Database,
  input: { workspace_id: string; message: SlackChannelMessage },
  turn: { spoke_to_the_agent: boolean },
): Promise<SlackSpeaker | { refusal: SlackSpeakerRefusal }> {
  const email = input.message.user_profile?.email;
  const member_user_id = email
    ? await find_active_workspace_member_by_email(db, { workspace_id: input.workspace_id, email })
    : null;
  if (!member_user_id) {
    const { text, ...silent } = email ? speaker_is_not_a_member : speaker_is_unknown;
    const said = email && is_team_mode_switched_on() ? how_a_team_member_is_known : text;
    return { refusal: turn.spoke_to_the_agent ? { ...silent, text: said } : silent };
  }
  return {
    member_user_id,
    source_actor: { ...build_slack_source_actor(input.message), platform_user_id: member_user_id },
  };
}

function build_slack_source_actor(target: SlackChannelMessage): SourceActor {
  const profile = target.user_profile;
  return create_external_source_actor({
    provider_key: 'slack',
    external_account_id: target.team_id,
    external_user_id: target.user_id,
    ...(profile?.username === undefined ? {} : { external_username: profile.username }),
    profile: build_slack_source_actor_profile(target),
    policy_state: 'allowed_to_chat',
    metadata: {
      slack: {
        is_bot: profile?.is_bot ?? false,
      },
    },
  });
}

function build_slack_source_actor_profile(target: SlackChannelMessage): SourceActorProfile {
  const profile = target.user_profile;
  return {
    display_name:
      profile?.display_name ?? profile?.real_name ?? profile?.username ?? target.user_id,
    ...(profile?.real_name === undefined ? {} : { real_name: profile.real_name }),
    ...(profile?.username === undefined ? {} : { username: profile.username }),
    ...(profile?.email === undefined ? {} : { email: profile.email }),
    ...(profile?.email_is_verified === undefined
      ? {}
      : { email_is_verified: profile.email_is_verified }),
    ...(profile?.avatar_url === undefined ? {} : { avatar_url: profile.avatar_url }),
    ...(profile?.timezone === undefined ? {} : { timezone: profile.timezone }),
    profile_source: profile?.profile_source ?? (profile ? 'provider_profile' : 'event_payload'),
    ...(profile?.profile_synced_time === undefined
      ? {}
      : { profile_synced_time: profile.profile_synced_time }),
  };
}

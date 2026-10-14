import type { get_session } from '@coworker/core/db/queries/sessions';

type RuntimeSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;

export function read_slack_resume_target(session: RuntimeSession) {
  const slack = session.source_metadata.slack;
  const team_id = slack?.team_id;
  const channel_id = slack?.channel_id;
  if (!team_id || !channel_id || !session.external_thread_key?.startsWith('slack:')) return null;

  const user = read_slack_session_user(session, team_id);
  if (!user) return null;

  return {
    team_id,
    channel_id,
    channel_type: read_slack_channel_type(slack?.channel_type, channel_id),
    thread_ts: slack?.thread_ts ?? read_thread_ts_from_key(session.external_thread_key),
    user_id: user.user_id,
    ...(user.user_profile ? { user_profile: user.user_profile } : {}),
  };
}

function read_slack_session_user(session: RuntimeSession, team_id: string) {
  const actors = session.session_metadata.actors ?? [];
  for (const actor of actors) {
    const external_id = actor.external_ids?.find(
      (entry) =>
        entry.provider_key === 'slack' &&
        entry.external_account_id === team_id &&
        entry.external_user_id,
    );
    const user_id = external_id?.external_user_id;
    if (!user_id) continue;

    const profile = actor.profile;
    return {
      user_id,
      user_profile: {
        display_name: profile?.display_name ?? null,
        real_name: profile?.real_name ?? null,
        username: profile?.username ?? null,
        email: profile?.email ?? null,
        avatar_url: profile?.avatar_url ?? null,
        timezone: profile?.timezone ?? null,
        profile_source: 'manual' as const,
      },
    };
  }

  return null;
}

function read_slack_channel_type(
  value: unknown,
  channel_id: string,
): 'im' | 'mpim' | 'channel' | 'group' {
  if (value === 'im' || value === 'mpim' || value === 'channel' || value === 'group') {
    return value;
  }
  if (channel_id.startsWith('D')) return 'im';
  if (channel_id.startsWith('G')) return 'group';
  return 'channel';
}

function read_thread_ts_from_key(external_thread_key: string) {
  const marker = ':thread:';
  const index = external_thread_key.indexOf(marker);
  return index === -1 ? null : external_thread_key.slice(index + marker.length);
}

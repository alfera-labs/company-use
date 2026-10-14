type SourceActorKind = 'platform_user' | 'external_user' | 'agent' | 'system';

export type SourceActorPolicyState =
  | 'allowed_to_chat'
  | 'allowed_to_run'
  | 'allowed_to_use_tools'
  | 'context_only'
  | 'blocked';

type SourceActorExternalId = {
  provider_key: string;
  external_account_id?: string | null;
  external_user_id: string;
  external_username?: string | null;
};

export type SourceActorProfile = {
  display_name?: string | null;
  real_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  email_is_verified?: boolean;
  timezone?: string | null;
  profile_source?: 'event_payload' | 'provider_profile' | 'platform_user' | 'manual';
  profile_synced_time?: string | null;
};

export type SourceActor = {
  source_actor_id: string;
  actor_kind: SourceActorKind;
  platform_user_id?: string | null;
  workspace_member_id?: string | null;
  external_ids: SourceActorExternalId[];
  profile: SourceActorProfile;
  policy_state?: SourceActorPolicyState;
  metadata?: Record<string, unknown>;
};

export type SessionSourceActor = SourceActor & {
  first_seen_time: string;
  last_seen_time: string;
  message_count: number;
  session_role?: 'initiator' | 'participant' | 'agent' | 'system';
};

export function create_external_source_actor(input: {
  provider_key: string;
  external_account_id?: string | null;
  external_user_id: string;
  external_username?: string | null;
  profile?: SourceActorProfile;
  policy_state?: SourceActorPolicyState;
  metadata?: Record<string, unknown>;
}): SourceActor {
  return {
    source_actor_id: format_external_source_actor_id(input),
    actor_kind: 'external_user',
    external_ids: [
      {
        provider_key: input.provider_key,
        ...(input.external_account_id === undefined
          ? {}
          : { external_account_id: input.external_account_id }),
        external_user_id: input.external_user_id,
        ...(input.external_username === undefined
          ? {}
          : { external_username: input.external_username }),
      },
    ],
    profile: normalize_source_actor_profile(input.profile ?? {}),
    ...(input.policy_state === undefined ? {} : { policy_state: input.policy_state }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function create_platform_source_actor(input: {
  platform_user_id: string;
  workspace_member_id?: string | null;
  profile?: SourceActorProfile;
  policy_state?: SourceActorPolicyState;
  metadata?: Record<string, unknown>;
}): SourceActor {
  return {
    source_actor_id: `platform:${input.platform_user_id}`,
    actor_kind: 'platform_user',
    platform_user_id: input.platform_user_id,
    ...(input.workspace_member_id === undefined
      ? {}
      : { workspace_member_id: input.workspace_member_id }),
    external_ids: [
      {
        provider_key: 'platform',
        external_user_id: input.platform_user_id,
      },
    ],
    profile: normalize_source_actor_profile({
      ...input.profile,
      profile_source: input.profile?.profile_source ?? 'platform_user',
    }),
    ...(input.policy_state === undefined ? {} : { policy_state: input.policy_state }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function merge_session_source_actor(
  existing_actors: SessionSourceActor[],
  source_actor: SourceActor,
  observed_time = new Date(),
): SessionSourceActor[] {
  const observed_time_iso = observed_time.toISOString();
  const actor_index = existing_actors.findIndex(
    (actor) => actor.source_actor_id === source_actor.source_actor_id,
  );
  if (actor_index === -1) {
    return [
      ...existing_actors,
      {
        ...source_actor,
        first_seen_time: observed_time_iso,
        last_seen_time: observed_time_iso,
        message_count: 1,
        session_role: source_actor.actor_kind === 'agent' ? 'agent' : 'participant',
      },
    ];
  }

  return existing_actors.map((actor, index) =>
    index === actor_index
      ? {
          ...actor,
          ...source_actor,
          first_seen_time: actor.first_seen_time,
          last_seen_time: observed_time_iso,
          message_count: actor.message_count + 1,
          ...(actor.session_role === undefined ? {} : { session_role: actor.session_role }),
        }
      : actor,
  );
}

function normalize_source_actor_profile(profile: SourceActorProfile): SourceActorProfile {
  return {
    ...(profile.display_name === undefined
      ? {}
      : { display_name: read_non_empty_text(profile.display_name) }),
    ...(profile.real_name === undefined
      ? {}
      : { real_name: read_non_empty_text(profile.real_name) }),
    ...(profile.username === undefined ? {} : { username: read_non_empty_text(profile.username) }),
    ...(profile.avatar_url === undefined
      ? {}
      : { avatar_url: read_non_empty_text(profile.avatar_url) }),
    ...(profile.email === undefined ? {} : { email: normalize_email(profile.email) }),
    ...(profile.email_is_verified === undefined
      ? {}
      : { email_is_verified: profile.email_is_verified }),
    ...(profile.timezone === undefined ? {} : { timezone: read_non_empty_text(profile.timezone) }),
    ...(profile.profile_source === undefined ? {} : { profile_source: profile.profile_source }),
    ...(profile.profile_synced_time === undefined
      ? {}
      : { profile_synced_time: profile.profile_synced_time }),
  };
}

function format_external_source_actor_id(input: {
  provider_key: string;
  external_account_id?: string | null;
  external_user_id: string;
}) {
  return input.external_account_id
    ? `${input.provider_key}:${input.external_account_id}:${input.external_user_id}`
    : `${input.provider_key}:${input.external_user_id}`;
}

function normalize_email(value: string | null | undefined) {
  return read_non_empty_text(value)?.toLowerCase() ?? null;
}

function read_non_empty_text(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

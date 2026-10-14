import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Participants } from '@coworker/core/access/may_use_resource';
import type {
  SessionMetadata,
  SessionSourceMetadataData,
} from '@coworker/core/db/schema/json_column_types';

const reader_actor_kinds: ReadonlySet<string> = new Set(['platform_user', 'external_user']);

export type ParticipantSources = {
  project_id: string | null;
  session_metadata: SessionMetadata;
  session_source_metadata: SessionSourceMetadataData | null;
  agent_ids: readonly string[];
};

export function build_participants(input: ParticipantSources): Participants {
  const actors = input.session_metadata.actors ?? [];
  return {
    project: input.project_id ? [input.project_id] : [],
    agent: [...input.agent_ids],
    user: [...read_reader_ids(actors), ...read_channel_audience(input.session_source_metadata)],
  };
}

// Slack conversations that more than one person reads: public and private channels, and group DMs.
const shared_slack_channel_types: ReadonlySet<string> = new Set(['channel', 'group', 'mpim']);

// Speakers are only the people who typed. Everyone else in a Slack channel reads the answer too,
// and nobody knows who they are, so the channel itself is one more reader. It holds no personal
// grant, so a connection restricted to named people ("Only Rob") is never used there, even when Rob
// is the only one talking. What the channel's project was given still works, and so does anything
// shared with everyone. A DM has no such audience: its reader is the sender.
function read_channel_audience(source: SessionSourceMetadataData | null): string[] {
  const slack = source?.slack;
  if (!slack?.channel_id || !shared_slack_channel_types.has(slack.channel_type ?? '')) return [];
  return [`slack_channel_audience:${slack.team_id ?? 'unknown'}:${slack.channel_id}`];
}

function read_reader_ids(actors: NonNullable<SessionMetadata['actors']>): string[] {
  const reader_ids = new Set<string>();
  for (const actor of actors) {
    if (!reader_actor_kinds.has(actor.actor_kind)) continue;
    reader_ids.add(actor.platform_user_id ?? actor.source_actor_id);
  }
  return [...reader_ids];
}

type RunSession = {
  project_id: string | null;
  session_metadata: SessionMetadata;
  source_metadata: SessionSourceMetadataData | null;
  agent_id: string;
};

/**
 * Who a run speaks for: the people of its chat, as `build_participants` reads them. One run is
 * different. In team mode a run that a schedule started speaks for no person, whoever wrote in
 * its chat before. Nobody is there when it runs, and an owner or an admin can change what the
 * task is told to do, so it must not carry the private connections of a person who once
 * answered in that chat. It keeps what its room and its coworker were given, and what is
 * shared with everyone. A run that a person starts by writing in the same chat speaks for
 * that person, as in any chat.
 */
export function build_run_participants(
  session: RunSession,
  trigger_type: string | undefined,
): Participants {
  const participants = build_participants({
    project_id: session.project_id,
    session_metadata: session.session_metadata,
    session_source_metadata: session.source_metadata,
    agent_ids: [session.agent_id],
  });
  if (trigger_type !== 'schedule' || !is_team_mode_switched_on()) return participants;
  return { ...participants, user: [] };
}

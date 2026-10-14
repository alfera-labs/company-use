import { create_logger } from '@coworker/shared';

const log = create_logger('run_audience');

/**
 * Who can read what a run says. `workspace` means every member of the workspace can; `narrow`
 * means fewer people can: one person, a project's members, a DM, a private channel. A narrow run
 * must leave nothing on the volume that every chat in the workspace reads. A run is workspace-wide
 * unless an explicit privacy fact says otherwise.
 */
export type RunAudience = 'workspace' | 'narrow';

export type RunAudienceFacts = {
  project_access: string | null;
  session_source: string;
  slack_channel_type: string | null;
  workspace_member_count: number;
};

export type RunAudienceDecision = {
  run_audience: RunAudience;
  reason: string;
  is_fallback: boolean;
};

const audience_by_project_access: Readonly<Record<string, RunAudience>> = {
  private: 'narrow',
  members: 'narrow',
  workspace: 'workspace',
};

const audience_by_slack_channel_type: Readonly<Record<string, RunAudience>> = {
  im: 'narrow',
  mpim: 'narrow',
  group: 'narrow',
  channel: 'workspace',
};

const audience_by_session_source: Readonly<Record<string, (facts: RunAudienceFacts) => Vote>> = {
  slack: (facts) => slack_channel_vote(facts.slack_channel_type),
};

type Vote = { run_audience: RunAudience; reason: string };

function project_access_vote(project_access: string | null): Vote | null {
  if (project_access === null) return null;
  return {
    run_audience: audience_by_project_access[project_access] ?? 'narrow',
    reason: `project_access:${project_access}`,
  };
}

function slack_channel_vote(slack_channel_type: string | null): Vote {
  const channel_type = slack_channel_type ?? 'unknown';
  return {
    run_audience: audience_by_slack_channel_type[channel_type] ?? 'narrow',
    reason: `slack_channel:${channel_type}`,
  };
}

function session_source_vote(facts: RunAudienceFacts): Vote | null {
  return audience_by_session_source[facts.session_source]?.(facts) ?? null;
}

/**
 * A workspace with one member has no second member for a run to hide from, so every run writes the
 * daily log and the shared activity as it did before audiences existed.
 * Otherwise a run is workspace-wide by default. Only an explicit privacy fact (a private or
 * members-only project, a Slack DM, group DM, or private channel) makes it narrow, and narrow wins
 * when facts disagree. No fact at all (a trigger, a schedule, an email, a project-less chat) keeps
 * the workspace default. A privacy setting whose value cannot be read (an unknown project access
 * value, a Slack session with no channel type) stays narrow, because it may be a private room.
 */
export function decide_run_audience(facts: RunAudienceFacts): RunAudienceDecision {
  if (facts.workspace_member_count <= 1) {
    return { run_audience: 'workspace', reason: 'single_member_workspace', is_fallback: false };
  }
  const votes = [project_access_vote(facts.project_access), session_source_vote(facts)].filter(
    (vote): vote is Vote => vote !== null,
  );
  const deciding_vote =
    votes.find((vote) => vote.run_audience === 'narrow') ??
    votes.find((vote) => vote.run_audience === 'workspace');
  if (!deciding_vote) {
    return {
      run_audience: 'workspace',
      reason: `no_privacy_fact:${facts.session_source}`,
      is_fallback: true,
    };
  }
  return { ...deciding_vote, is_fallback: deciding_vote.reason === 'slack_channel:unknown' };
}

export function is_audience_narrower_than_workspace(facts: RunAudienceFacts) {
  return decide_run_audience(facts).run_audience === 'narrow';
}

type RoomSession = {
  session_id: string;
  session_source: string;
  source_metadata: { slack?: { channel_type?: string } };
};

type RoomProject = { project_access: string; personal_for_user_id: string | null } | null;

/** Who a run's room is for: the one person a personal room belongs to, and the run's audience. */
export function read_room_audience(
  session: RoomSession,
  project: RoomProject,
  workspace_member_count: number,
) {
  const decision = decide_run_audience({
    project_access: project?.project_access ?? null,
    session_source: session.session_source,
    slack_channel_type: session.source_metadata.slack?.channel_type ?? null,
    workspace_member_count,
  });
  if (decision.is_fallback) {
    log.info('No privacy fact names this run audience; treating it as workspace-wide.', {
      session_id: session.session_id,
      reason: decision.reason,
    });
  }
  return {
    room_private_to: project?.personal_for_user_id ?? null,
    run_audience: decision.run_audience,
  };
}

/** The audience a tool call's run was started with, or null when the caller did not say. */
export function read_run_audience(metadata: Readonly<Record<string, unknown>> | undefined) {
  const value = metadata?.run_audience;
  return value === 'workspace' || value === 'narrow' ? value : null;
}

/** The audience a tool call writes its files for. A run that did not say is narrow, and logged. */
export function read_tool_call_audience(
  metadata: Readonly<Record<string, unknown>> | undefined,
  run_id: string,
): RunAudience {
  const run_audience = read_run_audience(metadata);
  if (run_audience) return run_audience;
  log.info('The run did not say who reads it; keeping its files off the shared volume.', {
    run_id,
  });
  return 'narrow';
}

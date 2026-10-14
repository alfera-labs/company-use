export type SlackTurnSubject = {
  team_id: string;
  channel_id: string;
  event_ts: string;
  thread_ts?: string | null;
};

export function build_slack_turn_queue_key(turn: SlackTurnSubject) {
  const root_ts = turn.thread_ts ?? turn.event_ts;
  return `slack:${turn.team_id}:${turn.channel_id}:thread:${root_ts}`;
}

import type { ScoutContext } from '@runtime-platform/scout/scout_context';
import type { ScoutSlackActivity } from '@runtime-platform/scout/slack_activity';

export function format_open_loops(open_loops: ScoutContext['open_loops']) {
  if (open_loops.length === 0) return 'Open loops: none.';
  return [
    `Open loops (${open_loops.length}), the things this workspace started and has not finished:`,
    ...open_loops.map(
      (loop) =>
        `- [${loop.kind}] ${loop.title} (${loop.reference_id}, since ${loop.since_time?.toISOString() ?? 'unknown'}): ${loop.detail}`,
    ),
  ].join('\n');
}

export function format_recent_signals(signals: ScoutContext['recent_signals']) {
  if (signals.length === 0) return 'Recent signals: none in the last three days.';
  const by_app = new Map<string, ScoutContext['recent_signals']>();
  for (const signal of signals) {
    by_app.set(signal.source, [...(by_app.get(signal.source) ?? []), signal]);
  }
  return [
    `Recent signals of the last three days, by app (${signals.length}), titles only:`,
    ...[...by_app.entries()].flatMap(([app_name, app_signals]) => [
      `${app_name} (${app_signals.length}):`,
      ...app_signals.map((signal) => `  - ${signal_line(signal)}`),
    ]),
  ].join('\n');
}

function signal_line(signal: ScoutContext['recent_signals'][number]) {
  return [
    signal.created_time,
    signal.event_type,
    signal.event_id,
    `[${signal.subject_id}]`,
    signal.sender ? `from ${signal.sender}` : null,
    `: ${signal.title}`,
    signal.door ? ` [door: ${signal.door}]` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function format_upcoming_events(events: ScoutContext['upcoming_events']) {
  if (events.length === 0) return '';
  return [
    `What is on the calendar in the next seven days (${events.length}):`,
    ...events.map((event) => `- ${event.when} (${event.app_name}): ${event.title}`),
  ].join('\n');
}

export function format_deliverables(deliverables: ScoutContext['recent_deliverables']) {
  if (deliverables.length === 0) return '';
  return [
    `What this workspace's own runs finished by saying, last seven days (${deliverables.length}):`,
    ...deliverables.map(
      (item) =>
        `- ${item.created_time.toISOString()} ${item.run_id} (session ${item.session_id}): ${item.first_line}`,
    ),
  ].join('\n');
}

export function format_automation_review(weeks: ScoutContext['automation_review']) {
  if (weeks.length === 0) return '';
  return [
    `How each automation's last seven days went (${weeks.length}):`,
    ...weeks.map((week) => {
      const skips = Object.entries(week.skipped_by_stage)
        .map(([stage, count]) => `${stage} ${count}`)
        .join(', ');
      const ends = week.notifications_by_end;
      return `- ${week.automation_name} (${week.automation_id}): fired ${week.fires}, ran ${week.ran}, turned away at the door ${skips || 'none'}; notifications ${week.notifications} (acted ${ends.acted}, dismissed ${ends.dismissed}, expired ${ends.expired}, still open ${ends.open}); held steps answered yes ${week.approvals_answered_yes}, no ${week.approvals_answered_no}`;
    }),
  ].join('\n');
}

export function format_memory_hits(hits: ScoutContext['memory_hits']) {
  if (hits.length === 0) return '';
  return [
    'What memory already knows about those words, by what was asked:',
    ...hits.map(
      (hit) => `- [${hit.cluster}] ${hit.document_title} (${hit.document_slug}): ${hit.snippet}`,
    ),
  ].join('\n');
}

export function format_slack_activity(activity: ScoutSlackActivity[]) {
  return [
    `Unanswered Slack activity, newest first (${activity.length} messages):`,
    activity.map((message) => JSON.stringify(message)).join('\n') ||
      'No unanswered Slack messages were stored.',
  ].join('\n');
}

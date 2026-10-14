import type { Database } from '@coworker/core';
import type { TriageVerdict } from '@runtime-platform/automations/triage_signal_verdict';
import { write_notification } from '@runtime-platform/notifications/write_notification';

const triage_actor = 'system:triage';
const triage_importance_to_interrupt = 0.8;
const automation_idea_score = 40;

export type TriageNotificationsInput = {
  workspace_id: string;
  agent_id: string;
  verdict: TriageVerdict;
  run_id: string;
  fire_event_id: string;
  now?: Date;
};

export async function write_triage_notifications(db: Database, input: TriageNotificationsInput) {
  const { verdict } = input;
  const told =
    verdict.important_now >= triage_importance_to_interrupt ? await tell_them_now(db, input) : null;
  const offered = verdict.could_automate ? await offer_the_automation(db, input) : null;
  return { told, offered };
}

async function tell_them_now(db: Database, input: TriageNotificationsInput) {
  const { verdict } = input;
  const written = await write_notification(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    actor_id: triage_actor,
    written_by: 'platform',
    ...(input.now ? { now: input.now } : {}),
    notification: {
      run_id: input.run_id,
      subject: verdict.subject,
      claim: verdict.claim,
      title: `${verdict.subject}: ${verdict.claim}`.slice(0, 200),
      body: verdict.importance_reason,
      urgency: verdict.urgency,
      score: Math.round(verdict.important_now * 100),
      reason: 'no automation was watching this, so triage looked at it',
      evidence: { event_ids: [input.fire_event_id] },
      proposed_action: verdict.automation_sentence
        ? { kind: 'offer_to_act', instruction: verdict.automation_sentence, needs_apps: [] }
        : { kind: 'none' },
    },
  });
  return written.outcome;
}

async function offer_the_automation(db: Database, input: TriageNotificationsInput) {
  const sentence = input.verdict.automation_sentence;
  if (!sentence) return null;
  const written = await write_notification(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    actor_id: triage_actor,
    written_by: 'platform',
    ...(input.now ? { now: input.now } : {}),
    notification: {
      run_id: input.run_id,
      subject: 'an automation nobody has yet',
      claim: sentence,
      title: 'Want me to do this every time?',
      body: sentence,
      urgency: 'fyi',
      score: automation_idea_score,
      reason: 'this keeps arriving and nothing standing handles it',
      evidence: { event_ids: [input.fire_event_id] },
      proposed_action: { kind: 'create_automation', instruction: sentence },
    },
  });
  return written.outcome;
}

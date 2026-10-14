import type { triggers } from '@coworker/core';
import type { AutomationWeekReview } from '@coworker/core/db/queries/automation_review_stats';
import { build_scout_prompt } from '@runtime-platform/scout/scout_prompt';
import { describe, expect, it } from 'vitest';

const empty_context = {
  recent_signals: [],
  open_loops: [],
  memory_hits: [],
  recent_deliverables: [],
  upcoming_events: [],
  automation_review: [],
  goals: [],
  watching: [],
};

const week: AutomationWeekReview = {
  automation_id: 'atm_1',
  automation_name: 'Late payments',
  fires: 12,
  ran: 2,
  skipped_by_stage: { judge: 10 },
  notifications: 4,
  notifications_by_end: { open: 1, acted: 0, dismissed: 3, expired: 0 },
  approvals_answered_yes: 0,
  approvals_answered_no: 1,
};

function prompt(automation_review: AutomationWeekReview[] = []) {
  return build_scout_prompt({
    trigger: { trigger_id: 'trg_1' } as unknown as typeof triggers.$inferSelect,
    activity: [],
    context: { ...empty_context, automation_review },
    max_actions: 3,
    now: new Date('2026-09-16T08:00:00Z'),
  });
}

describe('the scout prompt', () => {
  it('tells the scout to offer the exact next step, with the apps it needs', () => {
    const text = prompt();

    expect(text).toContain("kind: 'offer_to_act'");
    expect(text).toContain('needs_apps');
    expect(text).toContain('Say yes and I will');
  });

  it('offers standing work to a person instead of calling a tool that refuses it', () => {
    const text = prompt();

    expect(text).not.toContain('automations-create_automation-1');
    expect(text).toContain("proposed_action { kind: 'create_automation', instruction }");
    expect(text).toContain('urgency: deadline, expires_soon, routine, or fyi');
  });

  it('tells the scout to name an app it keeps seeing and nobody connected', () => {
    const text = prompt();

    expect(text).toContain("kind: 'connect_app'");
    expect(text).toContain('Connect <App> and I will <reason>');
    expect(text).toContain('Both still need evidence');
  });

  it('carries the weekly review only when the week to review is in front of it', () => {
    const weekly = prompt([week]);

    expect(weekly).toContain('first pulse of the week');
    expect(weekly).toContain("kind: 'improve_automation'");
    expect(weekly).toContain('Late payments (atm_1): fired 12, ran 2');
    expect(weekly).toContain('turned away at the door judge 10');
    expect(weekly).toContain('dismissed 3');
    expect(weekly).toContain('has its subject resolved');
    expect(weekly).toContain("kind: 'retire_automation'");
  });

  it('holds every notification to the contract: never a bare FYI, the held step attached', () => {
    const text = prompt();

    expect(text).toContain('A notification is never a bare FYI');
    expect(text).toContain('draft ready — send it?');
  });

  it('says nothing about automations on an ordinary pulse', () => {
    const text = prompt();

    expect(text).not.toContain('first pulse of the week');
    expect(text).not.toContain("kind: 'improve_automation'");
  });
});

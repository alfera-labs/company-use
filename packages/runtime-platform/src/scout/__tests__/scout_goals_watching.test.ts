import type { triggers } from '@coworker/core';
import type { ScoutContext } from '@runtime-platform/scout/scout_context';
import { build_scout_prompt } from '@runtime-platform/scout/scout_prompt';
import { describe, expect, it } from 'vitest';

const empty_context: ScoutContext = {
  recent_signals: [],
  open_loops: [],
  memory_hits: [],
  recent_deliverables: [],
  upcoming_events: [],
  goals: [],
  watching: [],
  automation_review: [],
};

function prompt(context: Partial<ScoutContext>) {
  return build_scout_prompt({
    trigger: { trigger_id: 'trg_1' } as unknown as typeof triggers.$inferSelect,
    activity: [],
    context: { ...empty_context, ...context },
    max_actions: 3,
    now: new Date('2026-09-16T08:00:00Z'),
  });
}

describe('the scout packet', () => {
  it('names each goal, its file and the last thing that moved it', () => {
    const text = prompt({
      goals: [
        {
          slug: 'sub-4-hour-marathon',
          objective: 'Run a marathon in under four hours',
          last_progress: '2026-09-09: 24k done',
        },
      ],
    });

    expect(text).toContain('Run a marathon in under four hours');
    expect(text).toContain('goals/sub-4-hour-marathon.md');
    expect(text).toContain('last progress: 2026-09-09: 24k done');
  });

  it('says a goal that never moved has no progress rather than leaving it blank', () => {
    const text = prompt({
      goals: [{ slug: 'learn-greek', objective: 'Learn Greek', last_progress: null }],
    });

    expect(text).toContain('last progress: none recorded');
  });

  it('names what each automation is waiting on, with the date it started waiting', () => {
    const text = prompt({
      watching: [
        {
          slug: 'answer-billing-questions',
          automation_id: 'atm_1',
          subject: 'The Acme invoice',
          since: '2026-09-10',
          notes: "Waiting on the customer's reply since Tue.",
        },
      ],
    });

    expect(text).toContain('The Acme invoice since 2026-09-10');
    expect(text).toContain("Waiting on the customer's reply since Tue.");
  });

  it('says nothing about either when there is nothing to say', () => {
    const text = prompt({});

    expect(text).not.toContain('Goals this workspace is pursuing');
    expect(text).not.toContain('What the automations are waiting on');
  });
});

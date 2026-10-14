// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GoalList, read_goal } from '@/components/app/automations/goals_page';
import { watching_file_path, watching_note_body } from '@/components/app/automations/watching_note';

const goal_file = [
  '---',
  'objective: Run a marathon in under four hours',
  'status: active',
  'review: weekly',
  'automation_id: atm_1',
  '---',
  '',
  '## Constraints',
  'No running on travel weeks.',
  '',
  '## Plan',
  'Long run every Saturday.',
  '',
  '## Progress',
  '- 2026-09-09: 24k done',
  '',
].join('\n');

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('reads the objective and the status out of the file the agent wrote', () => {
  const goal = read_goal('goals/sub-4-hour-marathon.md', goal_file);

  expect(goal?.slug).toBe('sub-4-hour-marathon');
  expect(goal?.objective).toBe('Run a marathon in under four hours');
  expect(goal?.status).toBe('active');
  expect(goal?.body).toContain('## Plan');
  expect(goal?.body).not.toContain('objective:');
});

it('is not a goal when the file has no frontmatter or no objective', () => {
  expect(read_goal('goals/notes.md', '# just notes')).toBeNull();
  expect(read_goal('goals/broken.md', '---\nstatus: active\n---\nnothing\n')).toBeNull();
});

it('shows the objective, the status, the plan and the progress, with a way to change the plan', () => {
  const goal = read_goal('goals/sub-4-hour-marathon.md', goal_file);
  if (!goal) throw new Error('the goal file did not read');
  const changed: string[] = [];

  act(() => {
    root.render(
      createElement(GoalList, {
        goals: [goal],
        onChangePlan: (picked) => changed.push(picked.slug),
      }),
    );
  });

  expect(container.textContent).toContain('Run a marathon in under four hours');
  expect(container.textContent).toContain('active');
  expect(container.textContent).toContain('Long run every Saturday.');
  expect(container.textContent).toContain('2026-09-09: 24k done');

  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Change plan',
  );
  act(() => button?.click());
  expect(changed).toEqual(['sub-4-hour-marathon']);
});

it('finds an automation note at the same path the runtime writes it to', () => {
  expect(watching_file_path('Answer billing questions')).toBe(
    'watching/answer-billing-questions.md',
  );
  expect(
    watching_note_body(
      '---\nautomation_id: atm_1\nsubject: The Acme invoice\nsince: 2026-09-10\n---\nWaiting on the customer.\n',
    ),
  ).toBe('Waiting on the customer.');
  expect(
    watching_note_body('---\nautomation_id: atm_1\n---\nHandled event abc. Sent the email.\n'),
  ).toBe('');
});

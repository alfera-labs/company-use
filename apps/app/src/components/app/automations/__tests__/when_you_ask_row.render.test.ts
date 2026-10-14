// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type { EditorTrigger } from '@/components/app/automations/automation_editor_model';
import { TriggerRowNotes } from '@/components/app/automations/trigger_row_notes';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function note_under(trigger: EditorTrigger) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(TriggerRowNotes, { trigger, app: null, actions: undefined, form_open: false }),
    ),
  );
  return container.textContent;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('says under a "When you ask" trigger how to start it, with the word of the button', () => {
  const when_you_ask = { key: 'trg_manual', input: { kind: 'manual' } } as EditorTrigger;

  expect(note_under(when_you_ask)).toBe('Press Test on this page, or ask in chat.');
});

it('says nothing under a schedule that runs', () => {
  const schedule = {
    key: 'trg_cron',
    input: { kind: 'schedule', cron: '0 9 * * *' },
  } as EditorTrigger;

  expect(note_under(schedule)).toBe('');
});

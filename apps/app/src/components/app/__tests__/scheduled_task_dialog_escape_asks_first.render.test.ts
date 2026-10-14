// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskEditDialog } from '@/components/app/scheduled_task_create_dialog';
import type { Trigger } from '@/lib/api';

const task = {
  trigger_id: 'trg_1',
  trigger_name: 'Morning report',
  trigger_type: 'schedule',
  trigger_status: 'enabled',
  schedule_expression: '0 9 * * *',
  agent_id: 'agt_1',
  trigger_config: { job_input: { instruction: 'Write the report.' } },
} as Trigger;

const question = 'Close without saving? Your changes are not kept.';
let root: Root | null = null;
let saves: unknown[];

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', async () => Response.json({ data: [] }));
  Object.assign(Element.prototype, { getAnimations: () => [] });
  saves = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const dialog = createElement(ScheduledTaskEditDialog, {
    task,
    isSaving: false,
    onSave: async (input) => saves.push(input),
  });
  act(() => root?.render(createElement(QueryClientProvider, { client }, dialog)));
  await press(button('Edit'));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function button(words: string) {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent) === words,
  );
  if (!found) throw new Error(`No button says "${words}".`);
  return found;
}

async function press(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

function name_field() {
  return document.querySelector<HTMLInputElement>('#scheduled-task-name');
}

async function type_the_name(name: string) {
  const field = name_field();
  if (!field) throw new Error('The form is not open.');
  const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set_value?.call(field, name);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press_escape() {
  const target = document.activeElement ?? document.body;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
}

const words_on_the_page = () => document.body.textContent ?? '';

describe('Escape in the form of a scheduled task', () => {
  it('closes the form at once when nothing was changed', async () => {
    expect(name_field()?.value).toBe('Morning report');

    await press_escape();

    expect(name_field()).toBeNull();
    expect(words_on_the_page()).not.toContain(question);
  });

  it('asks before it drops a change, and keeps the change when the person keeps editing', async () => {
    await type_the_name('Evening report');

    await press_escape();

    expect(name_field()?.value).toBe('Evening report');
    expect(words_on_the_page()).toContain(question);

    await press(button('Keep editing'));

    expect(name_field()?.value).toBe('Evening report');
    expect(words_on_the_page()).not.toContain(question);
    expect(button('Save')).toBeTruthy();
  });

  it('drops the change only after the person says so, and saves nothing', async () => {
    await type_the_name('Evening report');
    await press_escape();

    await press(button('Close without saving'));

    expect(name_field()).toBeNull();
    expect(saves).toEqual([]);
    await press(button('Edit'));
    expect(name_field()?.value).toBe('Morning report');
    expect(words_on_the_page()).not.toContain(question);
  });

  it('closes at once on Cancel, as before, with a change or without', async () => {
    await type_the_name('Evening report');

    await press(button('Cancel'));

    expect(name_field()).toBeNull();
    expect(words_on_the_page()).not.toContain(question);
  });
});

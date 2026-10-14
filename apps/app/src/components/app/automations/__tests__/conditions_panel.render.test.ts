// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type EditorValue,
  empty_editor_value,
} from '@/components/app/automations/automation_editor_model';
import type { TriggerTypeCatalog } from '@/components/app/automations/automations_api';
import { ConditionsPanel } from '@/components/app/automations/conditions_panel';
import { build_event_field_groups } from '@/components/app/automations/event_field_options';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest: EditorValue;

function mount(value: EditorValue, catalog?: TriggerTypeCatalog) {
  latest = value;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const render = (next: EditorValue) => {
    latest = next;
    root.render(createElement(ConditionsPanel, { value: next, onChange: render, catalog }));
  };
  act(() => render(value));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function values_box() {
  const box = container.querySelector<HTMLInputElement>(
    '[aria-label="Values, separated by commas"]',
  );
  if (!box) throw new Error('no values box');
  return box;
}

function type_into(box: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const one_check: EditorValue = {
  ...empty_editor_value(),
  rules: [{ field: 'from', operation: 'equals_any_of', values: [] }],
};

describe('an Only-if check', () => {
  it('keeps "a," on screen while typing and stores both values on the way out', () => {
    mount(one_check);
    type_into(values_box(), 'a,');
    expect(values_box().value).toBe('a,');

    type_into(values_box(), 'a, b');
    act(() => {
      values_box().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(latest.rules[0]?.values).toEqual(['a', 'b']);
  });

  it('asks for what to check on a filter that names no field', () => {
    mount({
      ...empty_editor_value(),
      rules: [{ field: '', operation: 'equals_any_of', values: [] }],
    });
    expect(container.textContent).toContain('Choose what to check, or remove this filter.');

    mount(one_check);
    expect(container.textContent).not.toContain('Choose what to check, or remove this filter.');
  });

  it('says the values box in plain words', () => {
    mount(one_check);
    expect(values_box().placeholder).toBe('Separate several with commas');
  });
});

const two_app_catalog = {
  count: 2,
  apps: [
    {
      app_id: 'composio_gmail',
      app_display_name: 'Gmail',
      trigger_types: [
        {
          node_key: 'gmail-new-1',
          display_name: 'New Gmail message received',
          display_name_without_app: 'New message received',
          event_fields: [
            { name: 'from', label: 'Sender' },
            { name: 'label_ids', label: 'Gmail labels' },
            { name: 'attachment_list', label: 'Attached files' },
            { name: 'cc', label: 'Copied to' },
          ],
        },
      ],
    },
    {
      app_id: 'composio_slack',
      app_display_name: 'Slack',
      trigger_types: [
        {
          node_key: 'slack-message-1',
          display_name: 'New Slack message',
          display_name_without_app: 'New message',
          event_fields: [
            { name: 'from', label: 'Sender' },
            { name: 'text', label: 'Message text' },
          ],
        },
      ],
    },
  ],
} as unknown as TriggerTypeCatalog;

const two_triggers: EditorValue = {
  ...one_check,
  rules: [{ field: 'label_ids', operation: 'equals_any_of', values: [] }],
  triggers: ['gmail-new-1', 'slack-message-1'].map((node_key) => ({
    key: node_key,
    input: { kind: 'app_event', node_key, subscription_config: {}, conditions: [] },
  })),
};

describe('the Only-if field picker', () => {
  it("groups fields by trigger, in the API's words, with a shared field once under Every trigger", () => {
    expect(build_event_field_groups(two_triggers, two_app_catalog)).toEqual([
      { group_label: 'Every trigger', options: [{ key: 'from', label: 'Sender' }] },
      {
        group_label: 'Gmail · New message received',
        options: [
          { key: 'attachment_list', label: 'Attached files' },
          { key: 'cc', label: 'Copied to' },
          { key: 'label_ids', label: 'Gmail labels' },
        ],
      },
      { group_label: 'Slack · New message', options: [{ key: 'text', label: 'Message text' }] },
    ]);
  });

  it('is the app picker, not a datalist, and names the chosen field in words', async () => {
    mount(two_triggers, two_app_catalog);
    expect(container.querySelector('datalist')).toBeNull();
    const picker = container.querySelector<HTMLElement>('[aria-label="Field"]');
    expect(picker?.textContent).toContain('Gmail labels');

    await act(async () => picker?.click());
    const listed = document.body.textContent ?? '';
    expect(listed).toContain('Gmail · New message received');
    expect(listed).toContain('Attached files');
    expect(listed).not.toContain('attachment_list');
  });
});

describe('the Only run if condition', () => {
  it('is one box that reads as a sentence: the title, then the condition in plain words', () => {
    mount(empty_editor_value());
    const box = container.querySelector<HTMLTextAreaElement>('[aria-label="Only run if"]');
    expect(box?.placeholder).toBe("it's a new customer asking for a price or a meeting");
    expect(box?.parentElement?.className).toContain('divide-y');
    expect(container.textContent).not.toContain('AI check');
  });
});

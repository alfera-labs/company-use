// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const save_calls: unknown[] = [];
let quiet_hours_in_file: unknown = { start: '19:00', end: '08:00', timezone: 'UTC' };
let may_edit_guidance = true;
vi.mock('@/components/app/automations/automations_api', () => ({
  read_notification_rules: async () => ({
    policy: {
      dial: 'normal',
      max_notifications_per_day: 5,
      quiet_hours: quiet_hours_in_file,
      delivery_channel_order: ['slack_dm'],
      daily_summary_cadence: 'weekdays',
      daily_summary_at_time: '07:45',
    },
    guidance: '',
    may_edit_guidance,
    policy_hash: 'h1',
  }),
  save_notification_rules: async (changes: { quiet_hours?: unknown }) => {
    save_calls.push(changes);
    if ('quiet_hours' in changes) quiet_hours_in_file = changes.quiet_hours;
    return { ok: true };
  },
}));

import { AttentionSettings } from '@/components/app/automations/attention_settings';
import { NotificationsSection } from '@/components/app/automations/notifications_section';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(AttentionSettings)));
  });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  save_calls.length = 0;
  quiet_hours_in_file = { start: '19:00', end: '08:00', timezone: 'UTC' };
  await mount();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function channel_switch(channel: string) {
  return channel_switch_in(container, channel);
}

function channel_switch_in(scope: ParentNode, channel: string) {
  const input = scope.querySelector<HTMLInputElement>(`#attention-channel-${channel}`);
  const row = input?.closest('div');
  const box = row?.querySelector<HTMLButtonElement>('[data-slot="switch"]');
  if (!box) throw new Error(`no switch ${channel}`);
  return box;
}

describe('the notification settings page', () => {
  it('changes on screen at once and saves a burst of clicks as one write', async () => {
    await act(async () => {
      channel_switch('email').click();
    });
    await act(async () => {
      channel_switch('web').click();
    });
    await act(async () => {
      channel_switch('email').click();
    });
    expect(channel_switch('web').hasAttribute('data-checked')).toBe(true);
    expect(channel_switch('email').hasAttribute('data-checked')).toBe(false);
    expect(save_calls).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save_calls).toEqual([{ delivery_channel_order: ['slack_dm', 'web'] }]);
  });

  it('says the summary time the file holds, not a time the page made up', () => {
    expect(container.textContent).toContain('One message a day at 07:45.');
    expect(container.textContent).not.toContain('08:30');
  });

  it('marks the chosen Notify me card, and only that one', () => {
    const card = (dial: string) => container.querySelector(`label[for="attention-${dial}"]`);
    expect(card('normal')?.className).toContain('border-brand');
    expect(card('off')?.className).not.toContain('border-brand');
    expect(card('quiet')?.className).not.toContain('border-brand');
    expect(card('eager')?.className).not.toContain('border-brand');
  });

  it('saves the Notify me card a person picks', async () => {
    const card = container.querySelector<HTMLElement>('label[for="attention-eager"]');
    if (!card) throw new Error('no Everything card');
    await act(async () => card.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save_calls).toEqual([{ dial: 'eager' }]);
  });

  it('saves a typed daily summary time', async () => {
    const time = container.querySelector<HTMLInputElement>('#attention-daily-summary-time');
    if (!time) throw new Error('no daily summary time box');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(time, '09:15');
      time.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save_calls).toEqual([{ daily_summary_at_time: '09:15' }]);
  });

  it('shows no times when quiet hours are off, and switches them on in a real zone', async () => {
    act(() => root.unmount());
    container.remove();
    quiet_hours_in_file = null;
    await mount();

    expect(container.querySelector('#attention-quiet-start')).toBeNull();
    const toggle = container.querySelector<HTMLElement>('#attention-quiet-on');
    if (!toggle) throw new Error('no quiet hours switch');
    expect(toggle.hasAttribute('data-checked')).toBe(false);

    await act(async () => toggle.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save_calls).toEqual([
      {
        quiet_hours: {
          start: '19:00',
          end: '08:00',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    ]);
    expect(container.querySelector<HTMLInputElement>('#attention-quiet-start')?.value).toBe(
      '19:00',
    );
  });

  it('turns quiet hours off as null in the file', async () => {
    const toggle = container.querySelector<HTMLElement>('#attention-quiet-on');
    await act(async () => toggle?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save_calls).toEqual([{ quiet_hours: null }]);
    expect(container.querySelector('#attention-quiet-start')).toBeNull();
  });

  it('gives the guidance box and the daily limit an accessible name', () => {
    const accessible_name = (selector: string) => {
      const label_id = container.querySelector(selector)?.getAttribute('aria-labelledby') ?? '';
      return document.getElementById(label_id)?.textContent;
    };
    expect(accessible_name('#attention-guidance')).toBe('In your own words');
    expect(accessible_name('#attention-daily-most')).toBe('At most, in a day');
  });
});

describe('closing the Notifications dialog', () => {
  it('saves a change made less than 400 ms before it closed as it closes, once', async () => {
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(NotificationsSection, {
            policy: undefined,
            automationId: 'atm_1',
            automationName: 'Lead intake',
          }),
        ),
      );
    });
    const change = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Change',
    );
    await act(async () => change?.click());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => channel_switch_in(document.body, 'email').click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(save_calls).toHaveLength(0);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(document.body.textContent).not.toContain('Notify me');
    expect(save_calls).toEqual([{ delivery_channel_order: ['slack_dm', 'email'] }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save_calls).toHaveLength(1);
  });
});

describe('the guidance every automation run reads', () => {
  const guidance_box = () => {
    const box = container.querySelector<HTMLTextAreaElement>('#attention-guidance');
    if (!box) throw new Error('no guidance box');
    return box;
  };

  async function write_and_leave(text: string) {
    await act(async () => {
      guidance_box().value = text;
      guidance_box().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }

  afterEach(() => {
    may_edit_guidance = true;
  });

  it('lets an owner or an admin write it', async () => {
    await write_and_leave('Tell me about late invoices.');

    expect(guidance_box().readOnly).toBe(false);
    expect(save_calls).toEqual([{ guidance: 'Tell me about late invoices.' }]);
  });

  it('shows it to a member read-only, says who can change it, and saves nothing', async () => {
    act(() => root.unmount());
    container.remove();
    may_edit_guidance = false;
    await mount();

    await write_and_leave('Mine now.');

    expect(guidance_box().readOnly).toBe(true);
    expect(container.textContent).toContain('Only an owner or an admin can change it.');
    expect(save_calls).toEqual([]);
  });
});

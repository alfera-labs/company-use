// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type { NotificationRules } from '@/components/app/automations/automations_api';
import { ChannelsField } from '@/components/app/automations/channels_field';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

type Channel = NotificationRules['delivery_channel_order'][number];

function offered_labels(
  delivery_channel_order: Channel[],
  channels_set_up: readonly Channel[] | undefined,
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(ChannelsField, {
        policy: { delivery_channel_order } as NotificationRules,
        change: () => {},
        channels_set_up,
      }),
    ),
  );
  return [...container.querySelectorAll('label')].map((label) => label.textContent);
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('offers every way when the install names none, as the hosted product does', () => {
  expect(offered_labels(['slack_dm'], undefined)).toEqual(['Slack', 'Email', 'This app']);
});

it('offers only the dashboard on an install that has no Slack app and no email', () => {
  expect(offered_labels(['web'], ['web'])).toEqual(['This app']);
});

it('still shows a way that is switched on and not set up, so it can be switched off', () => {
  expect(offered_labels(['web', 'slack_dm'], ['web'])).toEqual(['Slack', 'This app']);
});

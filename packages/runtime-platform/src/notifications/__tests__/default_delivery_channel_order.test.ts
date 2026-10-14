import {
  default_delivery_channel_order,
  delivery_channels_of_a_self_host,
} from '@runtime-platform/notifications/default_delivery_channel_order';
import { describe, expect, it } from 'vitest';

const nothing_set_up = {
  SLACK_CLIENT_ID: undefined,
  SLACK_CLIENT_SECRET: undefined,
  RESEND_API_KEY: undefined,
};

describe('the ways a person is reached when no rules file names any', () => {
  it('is Slack, email, then the dashboard on the hosted product', () => {
    expect(
      default_delivery_channel_order({ ...nothing_set_up, COWORKER_SELF_HOSTED: false }),
    ).toEqual(['slack_dm', 'email', 'web']);
  });

  it('is the dashboard alone on a self-host with no Slack app and no email', () => {
    expect(
      default_delivery_channel_order({ ...nothing_set_up, COWORKER_SELF_HOSTED: true }),
    ).toEqual(['web']);
  });

  it('names each channel a self-host has set up, in the same order', () => {
    const with_email = { ...nothing_set_up, COWORKER_SELF_HOSTED: true, RESEND_API_KEY: 'filler' };

    expect(default_delivery_channel_order(with_email)).toEqual(['email', 'web']);
    expect(
      default_delivery_channel_order({
        ...with_email,
        SLACK_CLIENT_ID: '123.456',
        SLACK_CLIENT_SECRET: 'filler',
      }),
    ).toEqual(['slack_dm', 'email', 'web']);
  });

  it('names the ways of a self-host, and names none for the hosted product', () => {
    expect(
      delivery_channels_of_a_self_host({ ...nothing_set_up, COWORKER_SELF_HOSTED: true }),
    ).toEqual(['web']);
    expect(
      delivery_channels_of_a_self_host({ ...nothing_set_up, COWORKER_SELF_HOSTED: false }),
    ).toBeNull();
  });
});

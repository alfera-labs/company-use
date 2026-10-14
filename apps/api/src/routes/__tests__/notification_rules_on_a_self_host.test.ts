import { create_app } from '@api/app';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { notification_rules_schema } from '@runtime-platform/notifications/notification_rules_schema';
import { afterEach, describe, expect, it } from 'vitest';

const settings_in_tests = {
  COWORKER_SELF_HOSTED: env.COWORKER_SELF_HOSTED,
  SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
  RESEND_API_KEY: env.RESEND_API_KEY,
};

const no_channel = {
  SLACK_CLIENT_ID: undefined,
  SLACK_CLIENT_SECRET: undefined,
  RESEND_API_KEY: undefined,
};

async function read_rules(settings: Partial<typeof env>) {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  Object.assign(env, settings);
  const response = await create_app(db).request('/v1/notification-rules');
  return (await response.json()).data;
}

describe('GET /v1/notification-rules on an install', () => {
  afterEach(() => {
    Object.assign(env, settings_in_tests);
  });

  it('names no set of ways on the hosted product, so the answer is what it was', async () => {
    const rules = await read_rules({ ...no_channel, COWORKER_SELF_HOSTED: false });

    expect(Object.keys(rules).sort()).toEqual([
      'file_path',
      'guidance',
      'may_edit_guidance',
      'policy',
      'policy_hash',
    ]);
  });

  it('names the dashboard alone on a self-host with no Slack app and no email', async () => {
    const rules = await read_rules({ ...no_channel, COWORKER_SELF_HOSTED: true });

    expect(rules.delivery_channels_set_up).toEqual(['web']);
  });

  it('names email too on a self-host that has set up email', async () => {
    const rules = await read_rules({
      ...no_channel,
      COWORKER_SELF_HOSTED: true,
      RESEND_API_KEY: 'filler',
    });

    expect(rules.delivery_channels_set_up).toEqual(['email', 'web']);
  });
});

describe('the default daily summary of an install', () => {
  afterEach(() => {
    Object.assign(env, settings_in_tests);
  });

  it('goes to Slack on the hosted product, as before', () => {
    Object.assign(env, { ...no_channel, COWORKER_SELF_HOSTED: false });

    expect(notification_rules_schema.parse({}).daily_summary_channel).toBe('slack_dm');
  });

  it('goes to the dashboard on a self-host with no Slack app and no email', () => {
    Object.assign(env, { ...no_channel, COWORKER_SELF_HOSTED: true });

    expect(notification_rules_schema.parse({}).daily_summary_channel).toBe('web');
  });
});

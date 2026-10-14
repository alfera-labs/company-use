import { create_app } from '@api/app';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { seed_native_trigger_catalog } from '@runtime-platform/tools/native_trigger_seed';
import { afterEach, describe, expect, it } from 'vitest';

const settings_in_tests = {
  COWORKER_SELF_HOSTED: env.COWORKER_SELF_HOSTED,
  INBOUND_EMAIL_DOMAIN: env.INBOUND_EMAIL_DOMAIN,
};

async function read_offered_app_names(settings: Partial<typeof env>) {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  await seed_native_trigger_catalog(db);
  Object.assign(env, settings);
  const response = await create_app(db).request('/v1/automations/trigger-types');
  const body = (await response.json()).data;
  return {
    count: body.count as number,
    app_names: body.apps.map((app: { app_name: string }) => app.app_name) as string[],
  };
}

describe('GET /v1/automations/trigger-types on an install', () => {
  afterEach(() => {
    Object.assign(env, settings_in_tests);
  });

  it('offers the email trigger on the hosted product, set up or not', async () => {
    const offered = await read_offered_app_names({
      COWORKER_SELF_HOSTED: false,
      INBOUND_EMAIL_DOMAIN: undefined,
    });

    expect(offered.app_names).toEqual(['alfera_email', 'notifications']);
    expect(offered.count).toBe(2);
  });

  it('offers no email trigger on a self-host that has not set up email', async () => {
    const offered = await read_offered_app_names({
      COWORKER_SELF_HOSTED: true,
      INBOUND_EMAIL_DOMAIN: undefined,
    });

    expect(offered.app_names).toEqual(['notifications']);
    expect(offered.count).toBe(1);
  });

  it('offers the email trigger on a self-host that has set up email', async () => {
    const offered = await read_offered_app_names({
      COWORKER_SELF_HOSTED: true,
      INBOUND_EMAIL_DOMAIN: 'mail.example.com',
    });

    expect(offered.app_names).toEqual(['alfera_email', 'notifications']);
  });
});

import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { beforeAll, describe, expect, it } from 'vitest';

const hosted_business_requests = [
  ['GET', '/v1/billing'],
  ['POST', '/v1/billing/checkout'],
  ['POST', '/v1/billing/topup'],
  ['POST', '/v1/billing/upgrade-now'],
  ['POST', '/v1/billing/portal'],
  ['POST', '/v1/billing/sync'],
  ['POST', '/v1/billing/webhook'],
  ['GET', '/v1/usage'],
  ['GET', '/v1/usage/runs'],
  ['GET', '/v1/usage/summary'],
  ['GET', '/v1/usage/daily'],
  ['GET', '/v1/credits'],
  ['GET', '/v1/rewards'],
  ['GET', '/v1/rewards/next-run-wall'],
  ['POST', '/v1/rewards/card-setup'],
  ['GET', '/v1/admin/billing/workspaces'],
  ['POST', '/v1/admin/billing/credit-grants'],
  ['POST', '/v1/admin/billing/pro-grants'],
  ['POST', '/v1/api-access-requests'],
  ['POST', '/v1/dev-settings/pro-trial'],
  ['POST', '/public/demo-requests'],
  ['POST', '/public/conversions/demo-booked'],
  ['POST', '/v1/answers'],
  ['GET', '/v1/answers/ans_1'],
] as const;

let app: ReturnType<typeof create_app>;

beforeAll(async () => {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  app = create_app(db);
});

describe('routes of the hosted business', () => {
  it.each(
    hosted_business_requests,
  )('%s %s answers 404 not_in_this_edition', async (method, path) => {
    const response = await app.request(path, { method });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_in_this_edition', message: 'This feature runs on Alfera Cloud.' },
    });
  });

  it('answers a route nobody has as a plain not_found, so the two are told apart', async () => {
    const response = await app.request('/v1/no-such-thing');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

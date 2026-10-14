import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { describe, expect, it } from 'vitest';

async function put_billing_source(source: string) {
  const app = create_app(await create_test_database());
  await app.request('/v1/workspace/model-provider-accounts');
  return app.request('/v1/workspace/model-provider-accounts/billing-source', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  });
}

describe('who a run bills, on an install that has no credits', () => {
  it('refuses credits as the source', async () => {
    expect((await put_billing_source('credits')).status).toBe(422);
  });

  it('accepts the own account as the source', async () => {
    expect((await put_billing_source('own_account')).status).toBe(200);
  });
});

describe('the domain challenge of a plugin directory', () => {
  it('is not a route of this install', async () => {
    const app = create_app(await create_test_database());

    const response = await app.request('/.well-known/openai-apps-challenge');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

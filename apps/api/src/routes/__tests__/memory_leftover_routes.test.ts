import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { beforeAll, describe, expect, it } from 'vitest';

const company_memory_requests = [
  ['POST', '/v1/api-keys/key_1/memory-scopes'],
  ['DELETE', '/v1/api-keys/key_1/memory-scopes/group:slack:T1:C1'],
  ['GET', '/v1/member-links'],
  ['POST', '/v1/member-links/actor_1/confirm'],
  ['POST', '/v1/member-links/actor_1/reject'],
] as const;

let app: ReturnType<typeof create_app>;

beforeAll(async () => {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  app = create_app(db);
});

describe('routes that need company memory', () => {
  it.each(
    company_memory_requests,
  )('%s %s answers 404 not_in_this_edition', async (method, path) => {
    const response = await app.request(path, { method });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_in_this_edition', message: 'This feature runs on Alfera Cloud.' },
    });
  });

  it('still lists API keys', async () => {
    const listed = await app.request('/v1/api-keys');

    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: [] });
  });

  it('lists no memory scope in the access table', async () => {
    const table = await app.request('/v1/access/table');

    expect(table.status).toBe(200);
    expect((await table.json()).data.memory_scopes).toEqual([]);
  });
});

import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { users } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type Database = Awaited<ReturnType<typeof create_test_database>>;

function person_headers(person: string) {
  return {
    'Content-Type': 'application/json',
    [proxy_auth_headers.secret]: 'local-development-internal-api-secret',
    [proxy_auth_headers.provider_key]: 'workos',
    [proxy_auth_headers.provider_user_id]: `wos_user_${person}`,
    [proxy_auth_headers.organization_id]: 'org_timezone_test',
    [proxy_auth_headers.email]: `${person}@timezone.test`,
  };
}

const first_person = person_headers('first');
const second_person = person_headers('second');

function set_timezone(app: ReturnType<typeof create_app>, headers: HeadersInit, timezone: string) {
  return app.request('/v1/me/timezone', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ timezone }),
  });
}

async function read_timezone(app: ReturnType<typeof create_app>, headers: HeadersInit) {
  const response = await app.request('/v1/me/timezone', { headers });
  return (await response.json()).data.timezone;
}

async function read_stored_user_data(db: Database, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row?.user_data;
}

describe('the time zone of the signed-in person', () => {
  it('is empty before the person sets one', async () => {
    const app = create_app(await create_test_database());

    expect(await read_timezone(app, first_person)).toBeNull();
  });

  it('is stored as the name the person sets, and read back', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await set_timezone(app, first_person, 'Asia/Tokyo');

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ timezone: 'Asia/Tokyo' });
    expect(await read_timezone(app, first_person)).toBe('Asia/Tokyo');
    expect(await read_stored_user_data(db, 'first@timezone.test')).toMatchObject({
      timezone: 'Asia/Tokyo',
    });
  });

  it('keeps the other keys of the person when the time zone changes', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    await app.request('/v1/onboarding/profile', {
      method: 'POST',
      headers: first_person,
      body: JSON.stringify({ role: 'Founder' }),
    });

    await set_timezone(app, first_person, 'America/Los_Angeles');

    expect(await read_stored_user_data(db, 'first@timezone.test')).toMatchObject({
      timezone: 'America/Los_Angeles',
      onboarding_profile: { role: 'Founder' },
    });
  });

  it.each([
    'Not/A_Zone',
    '+02:00',
    '-08:00',
    'UTC+2',
  ])('refuses %s, which is not a time zone name', async (timezone) => {
    const app = create_app(await create_test_database());
    await set_timezone(app, first_person, 'Europe/Rome');

    const response = await set_timezone(app, first_person, timezone);

    expect(response.status).toBe(422);
    expect(await read_timezone(app, first_person)).toBe('Europe/Rome');
  });

  it('does not change the time zone of another person', async () => {
    const app = create_app(await create_test_database());
    await set_timezone(app, second_person, 'Europe/Rome');

    await set_timezone(app, first_person, 'Asia/Tokyo');

    expect(await read_timezone(app, second_person)).toBe('Europe/Rome');
    expect(await read_timezone(app, first_person)).toBe('Asia/Tokyo');
  });
});

import { plan_egress_headers } from '@coworker/core/credentials/egress_header_rules';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_credentials_to_deliver } from '@coworker/core/db/queries/connection_credential_delivery';
import { create_session } from '@coworker/core/db/queries/sessions';
import { connections, events } from '@coworker/core/db/schema';
import {
  complete_app_sign_in,
  find_app_sign_in_form,
} from '@runtime-platform/connections/app_sign_in_setup_service';
import { create_app_awaiting_credentials } from '@runtime-platform/connections/discovered_app_service';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const workspace_id = 'ws_discovery';
const host = 'www.acmebooking.com';

const discovered = {
  app_display_name: 'Acme Planner',
  website_host: host,
  also_talks_to: [],
  logo_url: `https://${host}/logo.png`,
  sign_in_name_label: 'Email',
  could_not_determine: [],
  recipe: {
    visit_first: `https://${host}/signin`,
    post_credentials_to: `https://${host}/api/account/signin`,
    send_fields: { username: 'username', password: 'password' },
    always_send_headers: { 'X-Requested-With': 'XMLHttpRequest' },
    rejected_when_any_field_present: ['SIGNIN_FAIL'],
    read_wait_minutes_from_field: 'PASSWORD_WAIT',
    keep_cookies_named: ['session'],
    session_lasts_minutes: 1440,
  },
};

function answer(body: unknown, set_cookie: string[] = []) {
  return {
    status: 200,
    headers: { getSetCookie: () => set_cookie, get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

function stub_vendor(login_body: unknown) {
  const send = vi
    .fn()
    .mockResolvedValueOnce(answer('', ['session=live123; Path=/']))
    .mockResolvedValueOnce(answer(login_body));
  vi.stubGlobal('fetch', send);
  return send;
}

const propose = (db: Awaited<ReturnType<typeof create_test_database>>, overrides = {}) =>
  create_app_awaiting_credentials({
    db,
    workspace_id,
    actor_id: 'user_1',
    discovered: { ...discovered, ...overrides },
  });

afterEach(() => vi.unstubAllGlobals());

describe('connecting an app the agent discovered', () => {
  it('turns a discovery into a form asking for exactly two things', async () => {
    const db = await create_test_database();
    const outcome = await propose(db);
    expect(outcome).toMatchObject({ created: true, asks_for: ['Email', 'Password'] });

    const form = await find_app_sign_in_form({
      db,
      workspace_id,
      connection_id: (outcome as { connection_id: string }).connection_id,
    });

    expect(form).toMatchObject({
      app_display_name: 'Acme Planner',
      website_host: host,
      sign_in_name_label: 'Email',
    });
  });

  it('signs in with what the person typed and delivers the session', async () => {
    const db = await create_test_database();
    const { connection_id } = (await propose(db)) as { connection_id: string };
    stub_vendor({ result: 'success' });

    const result = await complete_app_sign_in({
      db,
      workspace_id,
      connection_id,
      actor_id: 'user_1',
      sign_in_name: 'test-account@example.invalid',
      password: 'not-a-real-password',
    });

    expect(result).toMatchObject({ connected: true });
    const plan = plan_egress_headers(
      await list_credentials_to_deliver(db, { workspace_id, now: new Date() }),
    );
    expect(plan.headers_by_host[host]?.Cookie).toBe('session=live123');
    expect(plan.could_not_be_attached).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('not-a-real-password');
  });

  it('records the interrupted ask and asks for a resume once the sign-in is accepted', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const resume = {
      session_id: session.session_id,
      actor_id: bootstrap.user_id,
      instruction: "Pull this week's bookings from Acme Planner.",
      created_at: new Date().toISOString(),
    };
    const proposed = (await create_app_awaiting_credentials({
      db,
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
      discovered,
      resume,
    })) as { connection_id: string };

    const pending = await db.query.connections.findFirst({
      where: eq(connections.connection_id, proposed.connection_id),
    });
    expect(pending?.setup_state).toMatchObject({ resume });

    stub_vendor({ result: 'success' });
    const result = await complete_app_sign_in({
      db,
      workspace_id: bootstrap.workspace_id,
      connection_id: proposed.connection_id,
      actor_id: bootstrap.user_id,
      sign_in_name: 'test-account@example.invalid',
      password: 'not-a-real-password',
    });
    expect(result).toMatchObject({ connected: true });

    const [resume_event] = await db
      .select()
      .from(events)
      .where(
        and(eq(events.source, 'connection'), eq(events.event_type, 'connection.resume_requested')),
      );
    expect(resume_event?.event_body).toMatchObject({
      connection_id: proposed.connection_id,
      resume: { instruction: resume.instruction },
    });
  });

  it('reports the site refusing, rather than looking connected', async () => {
    const db = await create_test_database();
    const { connection_id } = (await propose(db)) as { connection_id: string };
    stub_vendor({ SIGNIN_FAIL: true });

    const result = await complete_app_sign_in({
      db,
      workspace_id,
      connection_id,
      actor_id: 'user_1',
      sign_in_name: 'test-account@example.invalid',
      password: 'wrong',
    });

    expect(result).toMatchObject({ connected: false });
    expect(await list_credentials_to_deliver(db, { workspace_id, now: new Date() })).toEqual([]);
  });

  it('refuses a discovery whose sign-in points at another site', async () => {
    const db = await create_test_database();

    const outcome = await propose(db, {
      recipe: { ...discovered.recipe, post_credentials_to: 'https://attacker.example/collect' },
    });

    expect(outcome).toMatchObject({ created: false });
    expect(
      await db.select().from(connections).where(eq(connections.workspace_id, workspace_id)),
    ).toHaveLength(0);
  });

  it('reuses the first answer when the same site is proposed again', async () => {
    const db = await create_test_database();
    const first = (await propose(db)) as { connection_id: string };
    const second = (await propose(db)) as { connection_id: string };

    expect(second.connection_id).toBe(first.connection_id);
    expect(
      await db.select().from(connections).where(eq(connections.workspace_id, workspace_id)),
    ).toHaveLength(1);
  });
});

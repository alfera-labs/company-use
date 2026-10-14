import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_session_messages } from '@coworker/core/db/queries/sessions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const outside_call = vi.fn(async () => {
  throw new Error('onboarding called an outside service');
});

beforeEach(() => {
  outside_call.mockClear();
  vi.stubGlobal('fetch', outside_call);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function app_of_a_fresh_install() {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  return create_app(db);
}

describe('onboarding on an install with no company scan', () => {
  it('refuses a company scan as not_in_this_edition and calls nothing outside', async () => {
    const app = await app_of_a_fresh_install();

    const response = await app.request('/v1/onboarding/company-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ website_url: 'example.com' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_in_this_edition', message: 'This feature runs on Alfera Cloud.' },
    });
    expect(outside_call).not.toHaveBeenCalled();
  });

  it('offers no saved scan, then finishes into a first chat, and calls nothing outside', async () => {
    const app = await app_of_a_fresh_install();

    const snapshot = await (await app.request('/v1/onboarding')).json();
    const finished = await (
      await app.request('/v1/onboarding/complete', { method: 'POST' })
    ).json();
    const first_chat = await app.request(`/v1/sessions/${finished.data.first_session_id}`);

    expect(snapshot.data.company_scan).toBeNull();
    expect(finished.data.completed).toBe(true);
    expect(first_chat.status).toBe(200);
    expect(outside_call).not.toHaveBeenCalled();
  });

  it('offers three jobs that need no app, and opens the first chat on the one that was picked', async () => {
    const db = await create_test_database();
    const { workspace_id } = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const snapshot = await (await app.request('/v1/onboarding')).json();
    const [first_job] = snapshot.data.install.jobs_that_need_no_app;
    const finished = await (
      await app.request('/v1/onboarding/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ picked_job_name: first_job.name }),
      })
    ).json();
    const messages = await list_session_messages(db, workspace_id, finished.data.first_session_id);
    const on_screen = messages.filter((message) => message.is_user_visible);

    expect(snapshot.data.install.jobs_that_need_no_app).toHaveLength(3);
    expect(on_screen).toHaveLength(1);
    expect(on_screen[0]?.content_text?.split('\n\n').slice(1)).toEqual([
      "I'll run a task you describe every weekday at 9:00 and save the result in your workspace folder.",
      'What should I do every weekday at 9:00?',
    ]);
    expect(outside_call).not.toHaveBeenCalled();
  });

  it('names no app work in the first chat when no job was picked', async () => {
    const db = await create_test_database();
    const { workspace_id } = await bootstrap_default_workspace(db);

    const finished = await (
      await create_app(db).request('/v1/onboarding/complete', { method: 'POST' })
    ).json();
    const [greeting] = await list_session_messages(
      db,
      workspace_id,
      finished.data.first_session_id,
    );

    expect(greeting?.content_text).toContain('with no app connected');
    expect(greeting?.content_text).not.toMatch(/inbox|follow-up/iu);
  });
});

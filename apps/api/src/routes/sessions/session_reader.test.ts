import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let db: Database;
let app: ReturnType<typeof create_app>;
let session_id: string;

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  session_id = session.session_id;
  app = create_app(db);
});

async function request_stream_ticket(for_session_id: string) {
  const response = await app.request(`/v1/sessions/${for_session_id}/stream-ticket`, {
    method: 'POST',
  });
  const body = (await response.json()) as { error: { code: string } };
  return { status: response.status, error_code: body.error.code };
}

describe('require_session_reader', () => {
  it('reads a readable session once when two guards cover the path', async () => {
    const session_reads = vi.spyOn(db.query.sessions, 'findFirst');
    const answer = await request_stream_ticket(session_id);
    expect(answer).toEqual({ status: 404, error_code: 'live_stream_unavailable' });
    expect(session_reads).toHaveBeenCalledTimes(1);
  });

  it('refuses a session the person cannot read before the handler runs', async () => {
    const answer = await request_stream_ticket('ses_other');
    expect(answer).toEqual({ status: 404, error_code: 'not_found' });
  });

  it('answers 404 with no data when a read runs beside a failed access check', async () => {
    const response = await app.request('/v1/sessions/ses_other/messages');
    const body = (await response.json()) as { error: { code: string }; data?: unknown };
    expect({ status: response.status, error_code: body.error.code, data: body.data }).toEqual({
      status: 404,
      error_code: 'not_found',
      data: undefined,
    });
  });

  it('reads the messages of a readable session', async () => {
    const response = await app.request(`/v1/sessions/${session_id}/messages`);
    expect(response.status).toBe(200);
  });
});

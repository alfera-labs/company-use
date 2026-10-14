import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { workspaces } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';

export async function create_held_approval({ eligible = true }: { eligible?: boolean } = {}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await db
    .update(workspaces)
    .set({ inbound_email_username: 'acme-approval' })
    .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
  const user = await db.query.users.findFirst({
    where: (table, { eq: is }) => is(table.user_id, bootstrap.user_id),
  });
  if (!user) throw new Error('bootstrap user missing');

  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'app_event',
    actor_id: bootstrap.user_id,
  });
  const tool_call = await create_tool_call_started(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    tool_name: 'email-send-1',
    tool_input: { to: ['couple@example.com'], subject: 'Your date', text: 'It is free.' },
    tool_status: 'awaiting_approval',
    actor_id: bootstrap.user_id,
  });
  const created = await create_tool_policy_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key: 'wait:tool_policy:approval_card_test',
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: session.session_id,
      source_run_id: run.run_id,
      calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256: 'a'.repeat(64) }],
      requested_by: bootstrap.user_id,
      eligible_user_ids: eligible ? [bootstrap.user_id] : [],
    },
    actor_id: bootstrap.user_id,
  });

  return { db, bootstrap, wait: created.event_job, email: user.email };
}

export function stub_email_provider() {
  const fetch_mock = vi.fn(async (_url: string, init?: { method?: string }) =>
    init?.method === 'POST'
      ? new Response(JSON.stringify({ id: 'sent_approval_1' }), { status: 200 })
      : new Response(
          JSON.stringify({ id: 'sent_approval_1', message_id: '<a@inbox.test.alfera.ai>' }),
          { status: 200 },
        ),
  );
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubGlobal('fetch', fetch_mock);
  return fetch_mock;
}

export function read_sent_emails(fetch_mock: ReturnType<typeof stub_email_provider>) {
  return fetch_mock.mock.calls
    .map(([, init]) => init as unknown as { method?: string; body?: string })
    .filter((init) => init?.method === 'POST' && init.body)
    .map(
      (init) => JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string },
    );
}

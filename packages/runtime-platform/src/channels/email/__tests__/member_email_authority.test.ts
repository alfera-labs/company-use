import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_policy } from '@coworker/core/db/queries/policies';
import { get_run } from '@coworker/core/db/queries/sessions';
import { apps, nodes, workspaces } from '@coworker/core/db/schema';
import { start_email_channel_turn } from '@runtime-platform/channels/email/channel_turn';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspace_username = 'acme';
const member_email = 'founder@runtime.local';
const outside_node_key = 'reviews-publish_reply-1';

let outside_action_results: unknown[] = [];

const engine_that_tries_one_outside_action = (): RuntimeAgentEngine => ({
  engine_name: 'agent-core/pi/member-email-authority-test',
  async *run(input) {
    const execute_tool = input.tools.find((tool) => tool.tool_name.includes('execute_tool'));
    if (!execute_tool?.execute) throw new Error('the run was given no catalog tool door');
    outside_action_results.push(
      await execute_tool.execute(
        { node_key: outside_node_key, input: {} },
        { run_key: input.run_key, metadata: input.metadata, signal: input.signal },
      ),
    );
    yield {
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    };
  },
});

async function insert_tool_that_changes_something_outside(db: Database) {
  const actor_id = 'system:test';
  await db.insert(apps).values({
    app_id: 'app_reviews',
    app_name: 'reviews',
    app_key: 'reviews',
    catalog_scope: 'global',
    app_display_name: 'Reviews',
    auth_type: 'none',
    app_status: 'active',
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(nodes).values({
    node_id: 'node_reviews_publish_reply',
    app_id: 'app_reviews',
    app_key: 'reviews',
    node_name: 'publish_reply',
    catalog_scope: 'global',
    node_key: outside_node_key,
    node_version: 1,
    node_display_name: 'Publish a reply',
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    runtime_handler: 'unsupported.no_provider_in_this_test',
    node_runtime: 'connected_app',
    approval_policy: { mode: 'manual_review' },
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

function email_from(
  from_email: string,
  dmarc: InboundEmailMessage['sender_authentication']['dmarc'],
): InboundEmailMessage {
  return {
    email_id: `em_${from_email}_${dmarc}`,
    from: `Sender <${from_email}>`,
    from_email,
    to: [`${workspace_username}@inbox.test.alfera.ai`],
    cc: [],
    subject: 'OK',
    body_text: 'OK, publish it.',
    attachment_names: [],
    sender_authentication: { dmarc, spf: dmarc, dkim: dmarc },
    message_id: `<${from_email}-${dmarc}@example.com>`,
    references: [],
  };
}

function stub_resend() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/attachments')
        ? new Response(JSON.stringify({ data: [] }), { status: 200 })
        : new Response(JSON.stringify({ id: 'sent_1', message_id: '<stamped@resend>' }), {
            status: 200,
          }),
    ),
  );
}

async function run_an_email(message: InboundEmailMessage) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await db
    .update(workspaces)
    .set({ inbound_email_username: workspace_username })
    .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
  await seed_runtime_tool_catalog(db);
  await insert_tool_that_changes_something_outside(db);
  await set_policy(db, {
    workspace_id: bootstrap.workspace_id,
    resource_type: 'node',
    resource_id: outside_node_key,
    scope_type: 'workspace',
    scope_id: bootstrap.workspace_id,
    policy_mode: 'allow',
    actor_id: bootstrap.user_id,
  });

  const result = await start_email_channel_turn(db, {
    workspace_id: bootstrap.workspace_id,
    workspace_username,
    message,
  });
  if (!result.accepted) throw new Error(`the email turn was refused: ${result.code}`);
  const run = await get_run(db, bootstrap.workspace_id, result.run_id);
  return { run_owner: run?.created_by, outside_action: JSON.stringify(outside_action_results[0]) };
}

describe('what an email run may change outside the workspace', () => {
  beforeEach(() => {
    outside_action_results = [];
    configure_agent_engine(engine_that_tries_one_outside_action);
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    stub_resend();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('acts for a member whose address the mail provider proved', async () => {
    const { run_owner, outside_action } = await run_an_email(email_from(member_email, 'pass'));

    expect(outside_action).not.toContain('approval_required');
    expect(outside_action).toContain('unsupported_catalog_tool');
    expect(run_owner).toBe('system:email');
  });

  it('is refused when a member address is not proven', async () => {
    const { outside_action } = await run_an_email(email_from(member_email, 'fail'));

    expect(outside_action).toContain('no human authority');
  });

  it('is refused when a stranger writes from a proven address', async () => {
    const { outside_action } = await run_an_email(email_from('stranger@elsewhere.example', 'pass'));

    expect(outside_action).toContain('no human authority');
  });
});

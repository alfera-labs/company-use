import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment/local_session_env';
import { set_policy } from '@coworker/core/db/queries/policies';
import { reset_composio_client_for_tests } from '@runtime-platform/composio/composio_client';
import {
  create_gmail_fixture,
  type GmailFixture,
  insert_composio_gmail_connection,
  stub_gmail_through_composio,
  venue_subject,
} from '@runtime-platform/tools/gmail/__tests__/gmail_fixture';
import { read_tool_policy_call_targets } from '@runtime-platform/tools/policies/tool_policy_call';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const node_key = 'runtime-create_gmail_reply_draft-1';

async function workspace_with_brochure() {
  const root = await mkdtemp(path.join(tmpdir(), 'gmail-reply-tool-'));
  await writeFile(path.join(root, 'brochure.pdf'), Buffer.from('%PDF-1.4 brochure bytes'));
  return create_local_session_env({ working_directory: root });
}

async function run_tool(fixture: GmailFixture, tool_input: Record<string, unknown>) {
  return execute_runtime_tool(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: fixture.run_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.user_id,
    node_key,
    tool_input,
    environment: await workspace_with_brochure(),
  });
}

const reply_input = {
  reply_to_message_id: 'msg_couple',
  subject: venue_subject,
  body: '<p>Hi!</p>',
  body_type: 'html',
  attachment_paths: ['brochure.pdf'],
  attachment_names: ['Product brochure.pdf'],
};

describe('runtime-create_gmail_reply_draft-1', () => {
  beforeEach(() => reset_composio_client_for_tests());
  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('creates a threaded reply draft through the permitted Composio Gmail connection', async () => {
    const fixture = await create_gmail_fixture();
    await insert_composio_gmail_connection(fixture);
    const gmail = stub_gmail_through_composio({ stored_subject: venue_subject });

    const execution = await run_tool(fixture, reply_input);

    expect(execution.result).toMatchObject({
      success: true,
      data: {
        draft_id: 'r-draft',
        thread_id: 'thread_couple',
        same_thread: true,
        subject: venue_subject,
        attachments: [{ name: 'Product brochure.pdf', bytes: 23 }],
      },
      metadata: { connection_id: 'conn_gmail_composio', provider: 'composio' },
    });
    const uploaded = gmail.uploaded_mime();
    expect(uploaded).toContain(
      `Subject: =?UTF-8?B?${Buffer.from(venue_subject).toString('base64')}?=`,
    );
    expect(uploaded).toContain('In-Reply-To: <couple@mail.example.com>');
    expect(uploaded).toContain('To: couple@example.com');
    expect(uploaded).toContain('filename="Product brochure.pdf"');
    expect(gmail.every_url().some((url) => /send/u.test(url))).toBe(false);
  });

  it('replaces its own earlier draft in the thread and keeps a draft a person edited', async () => {
    const fixture = await create_gmail_fixture();
    await insert_composio_gmail_connection(fixture);
    const gmail = stub_gmail_through_composio({
      stored_subject: venue_subject,
      earlier_drafts: [
        { draft_id: 'r-first-try', message_id: 'm-first-try', boundary: 'alfera_first' },
        { draft_id: 'r-edited', message_id: 'm-edited', boundary: '----=_Part_edited' },
      ],
    });

    const execution = await run_tool(fixture, reply_input);

    expect(execution.result).toMatchObject({
      success: true,
      data: { draft_id: 'r-draft', replaced_draft_ids: ['r-first-try'] },
    });
    expect(gmail.deleted_drafts()).toEqual(['r-first-try']);
  });

  it('reports what Gmail stored differently and leaves the draft for a person', async () => {
    const fixture = await create_gmail_fixture();
    await insert_composio_gmail_connection(fixture);
    stub_gmail_through_composio({ stored_subject: 'Re: Wedding enquiry' });

    const execution = await run_tool(fixture, reply_input);

    expect(execution.result).toMatchObject({
      success: false,
      error: { code: 'draft_verification_failed' },
    });
    expect(execution.result.success ? '' : execution.result.error.message).toContain(
      'subject is "Re: Wedding enquiry"',
    );
  });

  it('obeys a Never policy scoped to the Gmail connection, before touching Gmail', async () => {
    const fixture = await create_gmail_fixture();
    await insert_composio_gmail_connection(fixture);
    const gmail = stub_gmail_through_composio({ stored_subject: venue_subject });
    await set_policy(fixture.db, {
      workspace_id: fixture.workspace_id,
      resource_type: 'node',
      resource_id: node_key,
      scope_type: 'connection',
      scope_id: 'conn_gmail_composio',
      policy_mode: 'never',
      actor_id: fixture.user_id,
    });

    const execution = await run_tool(fixture, reply_input);

    expect(execution.result).toMatchObject({
      error: { code: 'tool_blocked_by_workspace_policy' },
    });
    expect(gmail.every_url()).toEqual([]);
    const { targets } = await read_tool_policy_call_targets(fixture.db, fixture, [
      { tool_call_id: 'call_1', tool_name: node_key, input: reply_input },
    ]);
    expect(targets[0]?.connection_id).toBe('conn_gmail_composio');
  });

  it('refuses without a Gmail connection this conversation may use', async () => {
    const fixture = await create_gmail_fixture();
    await insert_composio_gmail_connection(fixture, { connection_status: 'revoked' });
    const gmail = stub_gmail_through_composio({ stored_subject: venue_subject });

    const execution = await run_tool(fixture, reply_input);

    expect(execution.result).toMatchObject({ error: { code: 'connection_required' } });
    expect(gmail.every_url()).toEqual([]);
  });
});

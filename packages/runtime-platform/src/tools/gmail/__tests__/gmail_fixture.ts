import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { vi } from 'vitest';
import { z } from 'zod';

export const venue_subject = 'Your questions about our offer 🎉';

const composio_gmail_profile = {
  connection_profile_key: 'composio:gmail:oauth2',
  version: 1,
  status: 'active',
  auth_method_key: 'composio_managed_oauth',
  setup_strategy: { type: 'hosted_connect_link', auth_scheme: 'OAUTH2' },
  runtime_credential_strategy: {
    type: 'provider_account_reference',
    send_to_provider_as: 'connected_account_id',
  },
  default_scopes: [],
};

export async function create_gmail_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  await insert_composio_gmail_catalog(db, actor.user_id);
  return {
    db,
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    user_id: actor.user_id,
    session_id: session.session_id,
    run_id: run.run_id,
  };
}

export type GmailFixture = Awaited<ReturnType<typeof create_gmail_fixture>>;

async function insert_composio_gmail_catalog(db: GmailFixture['db'], actor_id: string) {
  await db.insert(apps).values({
    app_id: 'app_gmail_composio',
    app_name: 'gmail_v2',
    app_key: 'gmail_v2',
    catalog_scope: 'global',
    app_display_name: 'Gmail',
    app_category: 'communication',
    auth_type: 'oauth2',
    app_status: 'active',
    allowed_request_origins: ['https://www.googleapis.com'],
    display_config: {},
    metadata: {
      source: 'composio',
      sourced_from: { provider: 'composio', provider_app_id: 'gmail', provider_app_slug: 'gmail' },
      provider_configs: [
        {
          provider_key: 'composio',
          provider_config_key: 'composio:gmail',
          version: 1,
          status: 'active',
          provider_app_key: 'gmail',
          setup_defaults: {},
          connection_profiles: [composio_gmail_profile],
        },
      ],
    },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(nodes).values({
    node_id: 'node_gmail_v2_get_api_proxy',
    app_id: 'app_gmail_composio',
    app_key: 'gmail_v2',
    catalog_scope: 'global',
    node_key: 'gmail_v2-get_api_proxy-1',
    node_name: 'get_api_proxy',
    node_version: 1,
    node_display_name: 'GET API proxy request',
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object' },
    approval_policy: { mode: 'none' },
    runtime_handler: 'composio.api_proxy',
    node_runtime: 'connected_app',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'composio',
    provider_config_key: 'composio:gmail',
    provider_config_version: 1,
    connection_profile_key: 'composio:gmail:oauth2',
    connection_profile_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: { proxy: { method: 'GET', url_mode: 'static_domain' } },
    metadata: { source: 'composio', required_connection: true },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

export async function insert_composio_gmail_connection(
  fixture: GmailFixture,
  overrides: Partial<typeof connections.$inferInsert> = {},
) {
  await fixture.db.insert(connections).values({
    connection_id: 'conn_gmail_composio',
    workspace_id: fixture.workspace_id,
    app_id: 'app_gmail_composio',
    connection_name: 'Venue Gmail',
    connection_status: 'active',
    connection_key: 'composio:gmail:conn_gmail_composio',
    provider_key: 'composio',
    provider_config_key: 'composio:gmail',
    provider_config_version: 1,
    connection_profile_key: 'composio:gmail:oauth2',
    connection_profile_version: 1,
    auth_method_key: 'composio_managed_oauth',
    external_account_id: 'ca_gmail',
    authorized_scopes: [],
    health_status: 'healthy',
    provider_account: { connected_account_id: 'ca_gmail', toolkit_slug: 'gmail' },
    metadata: { provider: 'composio' },
    created_by: fixture.user_id,
    last_updated_by: fixture.user_id,
    ...overrides,
  });
}

const proxy_request_schema = z.object({ endpoint: z.string(), method: z.string() });
const session_url = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?upload_id=s1';

export type EarlierDraft = { draft_id: string; message_id: string; boundary: string };

/** Stands in for Composio's proxy API and Google's upload session: the only third parties. */
export function stub_gmail_through_composio(input: {
  stored_subject: string;
  earlier_drafts?: EarlierDraft[];
}) {
  const urls: string[] = [];
  const deleted: string[] = [];
  let uploaded = '';
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      if (String(url) === session_url) {
        urls.push(String(url));
        uploaded = Buffer.from(init?.body as Uint8Array).toString('ascii');
        return answer(200, {
          id: 'r-draft',
          message: { id: 'm-draft', threadId: 'thread_couple' },
        });
      }
      const request = proxy_request_schema.parse(JSON.parse(String(init?.body)));
      urls.push(request.endpoint);
      if (request.method === 'DELETE') {
        deleted.push(request.endpoint.split('/drafts/')[1] ?? '');
        return answer(200, { status: 204, data: null });
      }
      const thread = answer_thread_request(request.endpoint, input.earlier_drafts ?? []);
      return answer(200, thread ?? gmail_answer(request, input.stored_subject));
    }),
  );
  return { every_url: () => urls, uploaded_mime: () => uploaded, deleted_drafts: () => deleted };
}

function answer_thread_request(endpoint: string, earlier_drafts: EarlierDraft[]) {
  if (endpoint.includes('/threads/thread_couple')) {
    const couple = { id: 'msg_couple', threadId: 'thread_couple', labelIds: ['INBOX'] };
    const drafts = earlier_drafts.map((draft) => ({
      id: draft.message_id,
      threadId: 'thread_couple',
      labelIds: ['DRAFT'],
      payload: {
        headers: [{ name: 'Content-Type', value: `multipart/mixed; boundary="${draft.boundary}"` }],
      },
    }));
    return { status: 200, data: { id: 'thread_couple', messages: [couple, ...drafts] } };
  }
  if (endpoint.includes('/drafts?maxResults')) {
    const listed = earlier_drafts.map((draft) => ({
      id: draft.draft_id,
      message: { id: draft.message_id, threadId: 'thread_couple' },
    }));
    const unrelated = { id: 'r-other', message: { id: 'm-other', threadId: 'thread_other' } };
    return { status: 200, data: { drafts: [...listed, unrelated] } };
  }
  return null;
}

function gmail_answer(request: z.infer<typeof proxy_request_schema>, stored_subject: string) {
  if (request.endpoint.includes('uploadType=resumable')) {
    return { status: 200, data: {}, headers: { location: session_url } };
  }
  if (request.endpoint.endsWith('/profile')) {
    return { status: 200, data: { emailAddress: 'venue@example.com' } };
  }
  if (request.endpoint.includes('/messages/msg_couple')) {
    const headers = [
      { name: 'Message-Id', value: '<couple@mail.example.com>' },
      { name: 'From', value: 'Anna <couple@example.com>' },
    ];
    return {
      status: 200,
      data: { id: 'msg_couple', threadId: 'thread_couple', payload: { headers } },
    };
  }
  if (request.endpoint.includes('/drafts/r-draft')) {
    const headers = [
      { name: 'Subject', value: stored_subject },
      { name: 'In-Reply-To', value: '<couple@mail.example.com>' },
    ];
    const parts = [
      { filename: '', body: { size: 11 } },
      { filename: 'Product brochure.pdf', body: { size: 23 } },
    ];
    const message = { id: 'm-draft', threadId: 'thread_couple', payload: { headers, parts } };
    return { status: 200, data: { id: 'r-draft', message } };
  }
  return { status: 404, data: { error: `unexpected ${request.method} ${request.endpoint}` } };
}

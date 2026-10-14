import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create_app } from '@api/app';
import { start_session_run_that_writes_files } from '@api/routes/__tests__/session_run_file_writes';
import { all_api_key_scopes, mint_workspace_api_key } from '@api/services/api_keys';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { build_alfera_api_node_key } from '@coworker/core/integrations/alfera_api_tools';
import { beforeEach, describe, expect, it } from 'vitest';

const repo_root = resolve(import.meta.dirname, '../../../../..');
const guide_path = ['oss/overlay/SELF_HOSTING.md', 'SELF_HOSTING.md']
  .map((path) => resolve(repo_root, path))
  .find((path) => existsSync(path));
const documented_session_body =
  '{"initial_events":[{"type":"user.message","content":[{"type":"text","text":"Write a short hello note and save it as hello.md"}]}]}';

type App = ReturnType<typeof create_app>;
type Answer = {
  status: number;
  body: { data?: { session_id?: string }; error?: { code: string; details?: { tool?: string } } };
};

let db: Database;
let app: App;
let workspace_id: string;
let secret: string;

async function call(path: string, method = 'GET', body?: string): Promise<Answer> {
  const response = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, body: (await response.json()) as Answer['body'] };
}

async function set_rule(rule: {
  scope_type: 'workspace' | 'connection';
  resource_type: 'node' | 'node_label';
  resource_id: string;
  policy_mode: 'ask' | 'never';
}) {
  const connection = await find_or_create_alfera_api_connection(db, workspace_id);
  const scope_id = rule.scope_type === 'workspace' ? workspace_id : connection.connection_id;
  const response = await app.request('/v1/policies', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...rule, scope_id }),
  });
  expect(response.status).toBe(200);
}

async function walk_the_documented_calls() {
  const me = await call('/v1/me');
  const created = await call('/v1/sessions', 'POST', documented_session_body);
  const session_id = created.body.data?.session_id ?? '';
  const events = await call(`/v1/sessions/${session_id}/events`);
  const files = await call(`/v1/sessions/${session_id}/files`);
  return { me, created, events, files };
}

describe('the calls of the guide section "Use it from your own code"', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    app = create_app(db);
    const minted = await mint_workspace_api_key(db, {
      workspace_id,
      user_id: bootstrap.user_id,
      key_name: 'my script',
      scopes: [...all_api_key_scopes],
      key_audience: 'internal',
    });
    secret = minted.secret;
  });

  it('are the calls this test sends', () => {
    const guide = readFileSync(guide_path ?? '', 'utf8');
    const section = guide.slice(guide.indexOf('## Use it from your own code'));

    expect(section).toContain('/v1/me -H "Authorization: Bearer $ALFERA_API_KEY"');
    expect(section).toContain(`-d '${documented_session_body}'`);
    expect(section).toContain('/v1/sessions/$SESSION_ID/events');
    expect(section).toContain('/v1/sessions/$SESSION_ID/files');
  });

  it('all answer on a new install, in the order the guide gives them', async () => {
    const { me, created, events, files } = await walk_the_documented_calls();

    expect(me.status).toBe(200);
    expect(created.status).toBe(201);
    expect(created.body.data?.session_id).toBeTruthy();
    expect(events.status).toBe(200);
    expect(files.status).toBe(200);
  });

  it('list each file the session wrote, once: hello.md where its task said, and not its notes', async () => {
    const created = await call('/v1/sessions', 'POST', documented_session_body);
    const session_id = created.body.data?.session_id ?? '';
    const run = await start_session_run_that_writes_files(db, { workspace_id, session_id });
    await run.write_file('tmp/draft.md', 'Hi');
    await run.write_file('hello.md', 'Hello');
    await run.write_file('daily-logs/2026-10-12.md', 'Wrote the hello note.');
    await run.write_file('hello.md', 'Hello!\n');
    await run.run_shell_line("printf 'Hi!' > made_by_a_command.md");

    const files = await app.request(`/v1/sessions/${session_id}/files`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const listed = ((await files.json()) as { data: { filename: string; size_bytes: number }[] })
      .data;

    expect(listed.map((file) => [file.filename, file.size_bytes])).toEqual([
      ['hello.md', 7],
      ['made_by_a_command.md', 3],
    ]);
  });

  it('all answer when the owner made every tool that changes data ask first', async () => {
    await set_rule({
      scope_type: 'workspace',
      resource_type: 'node_label',
      resource_id: 'changes_things',
      policy_mode: 'ask',
    });

    const { created, events, files } = await walk_the_documented_calls();

    expect(created.status).toBe(201);
    expect(events.status).toBe(200);
    expect(files.status).toBe(200);
  });

  it('still ask before a key renames the workspace under that rule', async () => {
    await set_rule({
      scope_type: 'workspace',
      resource_type: 'node_label',
      resource_id: 'changes_things',
      policy_mode: 'ask',
    });

    const renamed = await call('/v1/workspace', 'PATCH', JSON.stringify({ name: 'Northwind' }));

    expect(renamed.status).toBe(403);
    expect(renamed.body.error).toMatchObject({
      code: 'approval_required',
      details: { tool: 'rename_workspace' },
    });
  });

  it.each([
    {
      rule_says: 'a rule that names the tool says ask',
      rule: {
        scope_type: 'workspace',
        resource_type: 'node',
        resource_id: build_alfera_api_node_key('create_session'),
        policy_mode: 'ask',
      },
      code: 'approval_required',
    },
    {
      rule_says: 'the rule of the API connection says ask',
      rule: {
        scope_type: 'connection',
        resource_type: 'node_label',
        resource_id: 'changes_things',
        policy_mode: 'ask',
      },
      code: 'approval_required',
    },
    {
      rule_says: 'a workspace rule says never',
      rule: {
        scope_type: 'workspace',
        resource_type: 'node_label',
        resource_id: 'changes_things',
        policy_mode: 'never',
      },
      code: 'tool_blocked_by_workspace_policy',
    },
  ] as const)('do not open a session when $rule_says', async ({ rule, code }) => {
    await set_rule(rule);

    const created = await call('/v1/sessions', 'POST', documented_session_body);

    expect(created.status).toBe(403);
    expect(created.body.error?.code).toBe(code);
  });
});

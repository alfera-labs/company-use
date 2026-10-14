import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { hash_tool_input_for_approval } from '@coworker/core/db/queries/event_waits';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_session } from '@coworker/core/db/queries/sessions';
import {
  build_scheduled_task_run_authority,
  set_scheduled_task_authority,
} from '@coworker/core/services/scheduled_task_authority';
import { agent_heartbeat_actor } from '@coworker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve_catalog_tool = vi.hoisted(() => vi.fn());
vi.mock('@coworker/core/db/queries/catalog', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolve_catalog_tool,
}));

const { execute_catalog_tool } = await import('@runtime-platform/tools/catalog_tool_execution');

let db: Database;
let workspace_id: string;
let session_id: string;
let run_id: string;

describe('execute_catalog_tool approval gate', () => {
  beforeEach(async () => {
    resolve_catalog_tool.mockReset();
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    workspace_id = bootstrap.workspace_id;
    session_id = session.session_id;
    run_id = 'run_test';
    await set_policy(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'gmail-send_email-1',
      scope_type: 'workspace',
      scope_id: workspace_id,
      policy_mode: 'allow',
      actor_id: bootstrap.user_id,
    });
  });

  it('blocks a manual_review tool for a system actor', async () => {
    resolve_catalog_tool.mockResolvedValue(catalog_tool({ mode: 'manual_review' }));

    const result = await run_tool(agent_heartbeat_actor);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: { code: 'approval_required' } });
    const refusal = result.success ? '' : result.error.message;
    expect(refusal).toContain('did not run and nothing is waiting for approval');
    expect(refusal).toContain('a request they make themselves in the chat carries that authority');
    expect(refusal).not.toMatch(/slack/iu);
  });

  it('lets a human actor run the same manual_review tool', async () => {
    resolve_catalog_tool.mockResolvedValue(catalog_tool({ mode: 'manual_review' }));

    const result = await run_tool('user_01HUMAN');

    expect(result).toMatchObject({ error: { code: 'unsupported_catalog_tool' } });
  });

  it.each([
    'system:trigger',
    'system:connection_resume',
    'system:evals',
  ])('blocks untrusted actor %s from a manual_review tool', async (actor_id) => {
    resolve_catalog_tool.mockResolvedValue(catalog_tool({ mode: 'manual_review' }));

    const result = await run_tool(actor_id);

    expect(result).toMatchObject({ error: { code: 'approval_required' } });
  });

  it('lets a scheduled run use authority granted for its exact instruction', async () => {
    resolve_catalog_tool.mockResolvedValue(catalog_tool({ mode: 'manual_review' }));
    const instruction = 'Send the weekly update.';
    const stored_authority = set_scheduled_task_authority({}, 'user_01HUMAN', instruction);
    const run_authority = build_scheduled_task_run_authority(
      'trigger_01',
      stored_authority,
      instruction,
    );

    const result = await run_tool('system:trigger', run_authority ?? undefined);

    expect(result).toMatchObject({ error: { code: 'unsupported_catalog_tool' } });
  });

  it('lets a background run act on a person\u2019s answer to this exact call', async () => {
    resolve_catalog_tool.mockResolvedValue(catalog_tool({ mode: 'manual_review' }));
    await set_policy(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'gmail-send_email-1',
      scope_type: 'workspace',
      scope_id: workspace_id,
      policy_mode: 'ask',
      actor_id: 'user_01HUMAN',
    });

    const result = await run_tool('system:trigger', {
      policy_approval: {
        version: 1,
        answer: 'already_given',
        node_key: 'gmail-send_email-1',
        input_sha256: hash_tool_input_for_approval({}),
      },
    });

    expect(result).toMatchObject({ error: { code: 'unsupported_catalog_tool' } });
  });

  it('blocks the same background call when the answer is for different bytes', async () => {
    resolve_catalog_tool.mockResolvedValue(catalog_tool({ mode: 'manual_review' }));
    await set_policy(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'gmail-send_email-1',
      scope_type: 'workspace',
      scope_id: workspace_id,
      policy_mode: 'ask',
      actor_id: 'user_01HUMAN',
    });

    const result = await run_tool('system:trigger', {
      policy_approval: {
        version: 1,
        answer: 'already_given',
        node_key: 'gmail-send_email-1',
        input_sha256: hash_tool_input_for_approval({ to: ['someone@example.com'] }),
      },
    });

    expect(result).toMatchObject({ error: { code: 'approval_required' } });
  });

  it('lets a system actor run a read-only tool', async () => {
    resolve_catalog_tool.mockResolvedValue(
      catalog_tool({ mode: 'none' }, { node_name: 'find_email' }),
    );

    const result = await run_tool(agent_heartbeat_actor);

    expect(result).toMatchObject({ error: { code: 'unsupported_catalog_tool' } });
  });

  it('lets a human actor run a destructive tool without an id-in-text match', async () => {
    resolve_catalog_tool.mockResolvedValue(
      catalog_tool({ mode: 'manual_review' }, { node_name: 'trash_file' }),
    );

    const result = await run_tool('user_01HUMAN', {
      node_key: 'google_drive-trash_file-1',
      tool_input: { file_id: 'file_123' },
    });

    expect(result).toMatchObject({ error: { code: 'unsupported_catalog_tool' } });
  });
});

function run_tool(
  actor_id: string,
  options:
    | Record<string, unknown>
    | {
        source_metadata?: Record<string, unknown>;
        node_key?: string;
        tool_input?: Record<string, unknown>;
      } = {},
) {
  const is_tool_options =
    'node_key' in options || 'tool_input' in options || 'source_metadata' in options;
  const source_metadata = is_tool_options
    ? (options.source_metadata as Record<string, unknown> | undefined)
    : options;
  return execute_catalog_tool(db, {
    workspace_id,
    session_id,
    run_id,
    actor_id,
    node_key:
      is_tool_options && typeof options.node_key === 'string'
        ? options.node_key
        : 'gmail-send_email-1',
    tool_input:
      is_tool_options && options.tool_input && typeof options.tool_input === 'object'
        ? (options.tool_input as Record<string, unknown>)
        : {},
    ...(source_metadata
      ? { source_context: { source_type: 'runtime' as const, source_metadata } }
      : {}),
  });
}

function catalog_tool(approval_policy: { mode: string }, overrides: { node_name?: string } = {}) {
  const node_name = overrides.node_name ?? 'send_email';
  return {
    tool: {
      node_id: 'node_test',
      app_id: 'app_test',
      app_name: 'gmail',
      app_display_name: 'Gmail',
      node_name,
      node_key: `gmail-${node_name}-1`,
      runtime_handler: 'unsupported.fake_handler',
      approval_policy,
      auth_type: 'oauth',
      metadata: {},
    },
    connection: null,
    compatibility: { ok: true },
  };
}

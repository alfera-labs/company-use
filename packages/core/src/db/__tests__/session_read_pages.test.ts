import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  list_session_message_page,
  session_message_page_byte_budget,
} from '@coworker/core/db/queries/session_read_pages';
import { create_session } from '@coworker/core/db/queries/sessions';
import { run_messages } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

describe('list_session_message_page', () => {
  it('does not read the columns the API discards', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: 'user_test',
    });
    await db.insert(run_messages).values({
      run_message_id: 'msg_wide',
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: 'run_wide',
      message_role: 'tool_result',
      message_kind: 'tool_result',
      message_content: { type: 'tool_result', bulk: 'x'.repeat(50_000) },
      content_text: 'short',
      content_json: { bulk: 'y'.repeat(50_000) },
      message_sequence: 1,
      run_message_sequence: 1,
      created_by: 'user_test',
      last_updated_by: 'user_test',
    });

    const page = await list_session_message_page(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });
    const [row] = page.items;
    if (!row) throw new Error('expected the message back');

    expect(row.run_message_id).toBe('msg_wide');
    expect(row.message_content).toMatchObject({ type: 'tool_result' });
    expect(row.message_sequence).toBe(1);
    expect(row).not.toHaveProperty('content_json');
    expect(row).not.toHaveProperty('content_text');
    expect(row).not.toHaveProperty('metadata');
    expect(row).not.toHaveProperty('workspace_id');
  });

  it('still pages newest-first and hands back a cursor for older history', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: 'user_test',
    });
    await db.insert(run_messages).values(
      Array.from({ length: 5 }, (_, index) => ({
        run_message_id: `msg_${index}`,
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: 'run_1',
        message_role: 'user',
        message_kind: 'input',
        message_content: { type: 'text', text: `m${index}` },
        message_sequence: index + 1,
        run_message_sequence: index + 1,
        created_by: 'user_test',
        last_updated_by: 'user_test',
      })),
    );

    const newest = await list_session_message_page(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      limit: 2,
    });
    if (newest.next_cursor === null) throw new Error('expected a cursor for older history');
    const older = await list_session_message_page(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      limit: 2,
      before_sequence: newest.next_cursor,
    });

    expect(newest.items.map((row) => row.message_sequence)).toEqual([4, 5]);
    expect(newest.next_cursor).toBe(4);
    expect(older.items.map((row) => row.message_sequence)).toEqual([2, 3]);
  });

  it('ends the page at the byte budget and still delivers the oversized message alone', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: 'user_test',
    });
    const oversized_text = 'x'.repeat(session_message_page_byte_budget + 1_000);
    await db.insert(run_messages).values(
      Array.from({ length: 5 }, (_, index) => ({
        run_message_id: `msg_${index + 1}`,
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: 'run_1',
        message_role: 'tool_result',
        message_kind: 'tool_result',
        message_content: {
          type: 'text',
          text: index + 1 === 3 ? oversized_text : `m${index + 1}`,
        },
        message_sequence: index + 1,
        run_message_sequence: index + 1,
        created_by: 'user_test',
        last_updated_by: 'user_test',
      })),
    );

    const newest = await list_session_message_page(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });
    expect(newest.items.map((row) => row.message_sequence)).toEqual([4, 5]);
    expect(newest.next_cursor).toBe(4);

    if (newest.next_cursor === null) throw new Error('expected a cursor past the budget');
    const oversized_page = await list_session_message_page(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      before_sequence: newest.next_cursor,
    });
    expect(oversized_page.items.map((row) => row.message_sequence)).toEqual([3]);
    expect(oversized_page.next_cursor).toBe(3);

    if (oversized_page.next_cursor === null) throw new Error('expected a cursor past the big row');
    const rest = await list_session_message_page(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      before_sequence: oversized_page.next_cursor,
    });
    expect(rest.items.map((row) => row.message_sequence)).toEqual([1, 2]);
    expect(rest.next_cursor).toBeNull();
  });
});

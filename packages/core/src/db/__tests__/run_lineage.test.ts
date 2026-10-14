import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { describe, expect, it } from 'vitest';

describe('run lineage', () => {
  it('roots a top-level run at itself with no parent, and links a sub-run to its parent + root', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Lineage',
      actor_id: bootstrap.user_id,
    });

    const base = {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message' as const,
      actor_id: bootstrap.user_id,
    };

    const root = await create_run(db, base);
    expect(root.parent_run_id).toBeNull();
    expect(root.root_run_id).toBe(root.run_id);

    const child = await create_run(db, {
      ...base,
      parent_run_id: root.run_id,
      root_run_id: root.root_run_id,
    });
    expect(child.parent_run_id).toBe(root.run_id);
    expect(child.root_run_id).toBe(root.run_id);

    const grandchild = await create_run(db, {
      ...base,
      parent_run_id: child.run_id,
      root_run_id: child.root_run_id,
    });
    expect(grandchild.root_run_id).toBe(root.run_id);
    expect(grandchild.parent_run_id).toBe(child.run_id);
  });
});

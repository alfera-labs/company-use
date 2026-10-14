import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { upsert_source_actor } from '@coworker/core/db/queries/source_actors';
import {
  confirm_member_account_link,
  request_member_account_link,
} from '@runtime-platform/memory_host/member_link';
import { describe, expect, it } from 'vitest';

async function workspace_with_slack_source_actor() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const source_actor = await upsert_source_actor(db, {
    workspace_id: bootstrap.workspace_id,
    provider: 'slack',
    external_id: 'U_CANDIDATE',
    display_name: 'Candidate Person',
    actor_id: bootstrap.user_id,
  });
  return { db, ...bootstrap, source_actor_id: source_actor.source_actor_id };
}

describe('request_member_account_link', () => {
  it('writes member_link_state=pending_confirmation once', async () => {
    const workspace = await workspace_with_slack_source_actor();

    const result = await request_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: workspace.source_actor_id,
      candidate_user_id: workspace.user_id,
      actor_id: workspace.user_id,
    });

    expect(result).toEqual({ outcome: 'requested', candidate_user_id: workspace.user_id });
  });

  it('answers from the stored state and writes nothing on a second call', async () => {
    const workspace = await workspace_with_slack_source_actor();
    await request_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: workspace.source_actor_id,
      candidate_user_id: workspace.user_id,
      actor_id: workspace.user_id,
    });

    const second_call = await request_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: workspace.source_actor_id,
      candidate_user_id: 'user_someone_else',
      actor_id: workspace.user_id,
    });

    expect(second_call).toEqual({
      outcome: 'already_pending',
      candidate_user_id: workspace.user_id,
    });
  });

  it('a pending link never becomes linked through a second request call', async () => {
    const workspace = await workspace_with_slack_source_actor();
    await request_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: workspace.source_actor_id,
      candidate_user_id: workspace.user_id,
      actor_id: workspace.user_id,
    });

    await request_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: workspace.source_actor_id,
      candidate_user_id: workspace.user_id,
      actor_id: workspace.user_id,
    });

    const confirm_attempt = await confirm_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: workspace.source_actor_id,
      actor_id: workspace.user_id,
    });
    expect(confirm_attempt).toEqual({ outcome: 'confirmed', linked_user_id: workspace.user_id });
  });

  it('fails closed when the source actor does not exist', async () => {
    const workspace = await workspace_with_slack_source_actor();

    const result = await request_member_account_link(workspace.db, {
      workspace_id: workspace.workspace_id,
      source_actor_id: 'sact_does_not_exist',
      candidate_user_id: workspace.user_id,
      actor_id: workspace.user_id,
    });

    expect(result).toEqual({ outcome: 'source_actor_not_found' });
  });
});

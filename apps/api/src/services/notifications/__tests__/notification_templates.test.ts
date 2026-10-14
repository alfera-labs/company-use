import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  claim_notification_step,
  count_notification_sends,
} from '@coworker/core/db/queries/notification_log';
import { describe, expect, it } from 'vitest';

describe('notification send ledger claim is a lock', () => {
  it('only the first claim of a step wins; a concurrent claim loses and no double-count', async () => {
    const db = await create_test_database();
    const workspace_id = 'ws_ledger_test';
    const ref = { workspace_id, campaign_id: 'out_of_credits', episode: 'genesis', step: 0 };

    expect(await claim_notification_step(db, ref)).toBe(true);
    expect(await claim_notification_step(db, ref)).toBe(false);

    expect(
      await count_notification_sends(db, {
        workspace_id,
        campaign_id: 'out_of_credits',
        episode: 'genesis',
      }),
    ).toBe(1);
  });

  it('counts by episode, so a new episode resets after the previous one maxed out', async () => {
    const db = await create_test_database();
    const workspace_id = 'ws_episode_test';
    const first = { workspace_id, campaign_id: 'out_of_credits', episode: 'grant-A', step: 0 };
    const second = { workspace_id, campaign_id: 'out_of_credits', episode: 'grant-B', step: 0 };

    await claim_notification_step(db, first);
    expect(
      await count_notification_sends(db, {
        workspace_id,
        campaign_id: 'out_of_credits',
        episode: 'grant-A',
      }),
    ).toBe(1);
    expect(
      await count_notification_sends(db, {
        workspace_id,
        campaign_id: 'out_of_credits',
        episode: 'grant-B',
      }),
    ).toBe(0);
    expect(await claim_notification_step(db, second)).toBe(true);
  });
});

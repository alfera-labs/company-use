import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { billing_credit_ledger, billing_plans, subscriptions } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

describe('a fresh install, after every migration ran', () => {
  it('holds no plan row, so no price and no included credit amount', async () => {
    const db = await create_test_database();

    expect(await db.select().from(billing_plans)).toEqual([]);
  });

  it('holds no subscription row and no credit ledger row', async () => {
    const db = await create_test_database();

    expect(await db.select().from(subscriptions)).toEqual([]);
    expect(await db.select().from(billing_credit_ledger)).toEqual([]);
  });
});

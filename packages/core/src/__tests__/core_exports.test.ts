import { create_local_actor } from '@coworker/core/auth';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

describe('@coworker/core', () => {
  it('exposes the auth boundary', () => {
    expect(
      create_local_actor({
        user_id: 'user_test',
        workspace_id: 'ws_test',
      }),
    ).toEqual({
      user_id: 'user_test',
      workspace_id: 'ws_test',
    });
  });

  it('exposes the database boundary', async () => {
    const core = await import('@coworker/core/db');
    expect(typeof core.create_database).toBe('function');
  });

  it('exposes database schema subpaths', async () => {
    const schema = await import('@coworker/core/db/schema');
    expect(schema.users).toBeDefined();
    expect(create_id(id_prefixes.user)).toMatch(/^user_/);
  });
});

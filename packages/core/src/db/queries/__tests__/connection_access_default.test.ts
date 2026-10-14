import {
  type ConnectionAccessType,
  with_access_for_a_new_connection,
} from '@coworker/core/db/queries/connection_access';
import { afterEach, describe, expect, it, vi } from 'vitest';

type NewConnection = { app_id: string; access_type?: ConnectionAccessType };
const nothing_chosen: NewConnection = { app_id: 'app_1' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the access of a connection whose maker did not choose one', () => {
  it('is the maker alone in team mode, where several people share the install', () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    expect(with_access_for_a_new_connection(nothing_chosen)).toEqual({
      app_id: 'app_1',
      access_type: 'restricted',
    });
  });

  it('is what the maker chose, when they chose', () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    const chosen: NewConnection = { app_id: 'app_1', access_type: 'shared' };
    expect(with_access_for_a_new_connection(chosen)).toBe(chosen);
  });

  it('is left as it was outside team mode: shared with the workspace', () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect(with_access_for_a_new_connection(nothing_chosen)).toBe(nothing_chosen);
  });
});

import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  list_install_connections,
  save_install_connection,
} from '@coworker/core/db/queries/install_connections';
import { describe, expect, it } from 'vitest';

describe('saving an install connection again', () => {
  it('keeps the metadata keys the new save does not name', async () => {
    const db = await create_test_database();
    const first = { connection_key: 'zq-test', values: { KEY: 'one' }, actor_id: 'system' };
    await save_install_connection(db, {
      ...first,
      connection_metadata: { secret_hint: 'aaaa', noted_by_another_writer: 'kept' },
    });
    await save_install_connection(db, {
      ...first,
      connection_metadata: { secret_hint: 'bbbb', error_message: null },
    });

    const [row] = await list_install_connections(db, ['zq-test']);
    expect(row?.connection_metadata).toEqual({
      secret_hint: 'bbbb',
      error_message: null,
      noted_by_another_writer: 'kept',
    });
  });
});

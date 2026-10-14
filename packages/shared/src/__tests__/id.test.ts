import { create_id, id_prefixes, parse_id } from '@shared/id';
import { describe, expect, it } from 'vitest';

describe('TypeID helpers', () => {
  it('creates IDs with canonical prefixes', () => {
    const session_id = create_id(id_prefixes.session);

    expect(session_id.startsWith('ses_')).toBe(true);
    expect(() => parse_id(session_id, id_prefixes.session)).not.toThrow();
  });

  it('rejects a valid TypeID with the wrong prefix', () => {
    const run_id = create_id(id_prefixes.run);

    expect(() => parse_id(run_id, id_prefixes.session)).toThrow();
  });
});

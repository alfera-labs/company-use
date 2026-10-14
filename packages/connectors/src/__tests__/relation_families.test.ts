import { read_relation_family } from '@connectors/relation_families';
import { describe, expect, it } from 'vitest';

describe('relation families registry', () => {
  it('maps a built-in relation to its registered link family', () => {
    expect(read_relation_family([], 'assignee')).toEqual({
      relation: 'assignee',
      link_family: 'mentions',
      inverse_relation: null,
      allowed_link_methods: ['provider_native', 'authored', 'human', 'model_proposed'],
      registered: true,
    });
    expect(read_relation_family([], 'belongs_in').link_family).toBe('in_container');
    expect(read_relation_family([], 'reply_to').link_family).toBe('thread');
    expect(read_relation_family([], 'replaces').link_family).toBe('cites');
  });

  it('falls back an unregistered relation to mentions', () => {
    expect(read_relation_family([], 'sponsors')).toEqual({
      relation: 'sponsors',
      link_family: 'mentions',
      inverse_relation: null,
      allowed_link_methods: [],
      registered: false,
    });
  });

  it('comes back registered when a host or connector record names the relation', () => {
    const host_records = [
      {
        relation: 'sponsors',
        link_family: 'thread' as const,
        inverse_relation: null,
        allowed_link_methods: ['provider_native' as const],
      },
    ];
    expect(read_relation_family(host_records, 'sponsors')).toEqual({
      ...host_records[0],
      registered: true,
    });
  });
});
